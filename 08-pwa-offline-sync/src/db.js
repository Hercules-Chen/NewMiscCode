// SQLite persistence using Node's built-in node:sqlite (no native build needed).
// Records carry a server-side version number; mutations are idempotent by Idempotency-Key.
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','issue','fixed')),
  photo       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS idempotency (
  key         TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  status      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export const STATUSES = ['ok', 'issue', 'fixed'];
const MAX_PHOTO = 1_500_000;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

function rowToRecord(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, location: r.location, note: r.note, status: r.status,
    photo: r.photo || null, version: r.version, deleted: !!r.deleted,
    createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by,
  };
}

export function validateInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'JSON object body required');
  const out = {};
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, 'title_required', 'title is required');
    if (body.title.length > 200) throw new HttpError(400, 'title_too_long', 'title max 200 chars');
    out.title = body.title.trim();
  }
  for (const f of ['location', 'note']) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== 'string' || body[f].length > 5000) throw new HttpError(400, `bad_${f}`, `${f} must be a string (max 5000)`);
      out[f] = body[f];
    }
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, 'bad_status', `status must be one of ${STATUSES.join(',')}`);
    out.status = body.status;
  }
  if (body.photo !== undefined && body.photo !== null) {
    if (typeof body.photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(body.photo) || body.photo.length > MAX_PHOTO) {
      throw new HttpError(400, 'bad_photo', 'photo must be a data:image/* base64 URL under 1.5 MB');
    }
    out.photo = body.photo;
  } else if (body.photo === null) out.photo = null;
  return out;
}

export async function openDb(dataDir) {
  let file = ':memory:';
  if (dataDir) { await mkdir(dataDir, { recursive: true }); file = join(dataDir, 'pwa-offline-sync.sqlite'); }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  return new Store(db, file);
}

export class Store {
  constructor(db, file) {
    this.db = db;
    this.file = file;
    this.q = {
      list: db.prepare('SELECT * FROM records WHERE updated_at > ? ORDER BY updated_at DESC'),
      listAll: db.prepare('SELECT * FROM records ORDER BY updated_at DESC'),
      get: db.prepare('SELECT * FROM records WHERE id = ?'),
      insert: db.prepare(`INSERT INTO records (id,title,location,note,status,photo,version,deleted,created_at,updated_at,updated_by)
        VALUES (?,?,?,?,?,?,1,0,?,?,?)`),
      update: db.prepare(`UPDATE records SET title=?, location=?, note=?, status=?, photo=?, version=version+1, deleted=?, updated_at=?, updated_by=? WHERE id=?`),
      idemGet: db.prepare('SELECT * FROM idempotency WHERE key = ?'),
      idemPut: db.prepare('INSERT INTO idempotency (key,fingerprint,status,body,created_at) VALUES (?,?,?,?,?)'),
      idemPrune: db.prepare('DELETE FROM idempotency WHERE created_at < ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM records WHERE deleted = 0'),
    };
  }

  close() { this.db.close(); }

  list({ since } = {}) {
    const rows = since ? this.q.list.all(since) : this.q.listAll.all();
    return rows.map(rowToRecord);
  }
  get(id) { return rowToRecord(this.q.get.get(id)); }
  count() { return this.q.count.get().n; }

  /**
   * Run a mutation idempotently. If `key` was seen before with the same fingerprint, the stored
   * response is returned (replayed=true) without re-executing. Different fingerprint -> 422.
   * The mutation and the idempotency row are committed in one transaction.
   */
  idempotent(key, fingerprint, fn) {
    if (key !== undefined && key !== null) {
      if (typeof key !== 'string' || key.length < 8 || key.length > 200) throw new HttpError(400, 'bad_idempotency_key', 'Idempotency-Key must be 8..200 chars');
    }
    if (key) {
      const prev = this.q.idemGet.get(key);
      if (prev) {
        if (prev.fingerprint !== fingerprint) throw new HttpError(422, 'idempotency_key_reused', 'Idempotency-Key was used for a different request');
        return { status: prev.status, body: JSON.parse(prev.body), replayed: true };
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let result;
      try { result = fn(); } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        result = { status: e.status, body: { error: e.code, message: e.message, ...e.extra } };
      }
      // Only remember definitive outcomes (2xx and 409 conflicts); validation errors may be retried after a fix.
      if (key && (result.status < 300 || result.status === 409)) {
        this.q.idemPut.run(key, fingerprint, result.status, JSON.stringify(result.body), new Date().toISOString());
      }
      this.db.exec('COMMIT');
      return { ...result, replayed: false };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  create(input, { by = '' } = {}) {
    const data = validateInput(input);
    const id = input.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(400, 'bad_id', 'id must be 8..64 chars [A-Za-z0-9_-]');
    const existing = this.get(id);
    if (existing) throw new HttpError(409, 'conflict', 'record already exists', { server: existing });
    const now = new Date().toISOString();
    this.q.insert.run(id, data.title, data.location ?? '', data.note ?? '', data.status ?? 'ok', data.photo ?? null, now, now, by);
    return { status: 201, body: { record: this.get(id) } };
  }

  update(id, input, { by = '', force = false } = {}) {
    const existing = this.get(id);
    if (!existing) throw new HttpError(404, 'not_found', 'record not found');
    const base = input?.baseVersion;
    if (!force && !Number.isInteger(base)) throw new HttpError(400, 'base_version_required', 'baseVersion (integer) is required');
    if (!force && base !== existing.version) throw new HttpError(409, 'conflict', 'version conflict', { server: existing, baseVersion: base });
    const data = validateInput(input, { partial: true });
    const merged = { ...existing, ...data };
    const deleted = input.deleted === true ? 1 : (input.deleted === false ? 0 : (existing.deleted ? 1 : 0));
    this.q.update.run(merged.title, merged.location, merged.note, merged.status, merged.photo ?? null, deleted, new Date().toISOString(), by, id);
    return { status: 200, body: { record: this.get(id) } };
  }

  pruneIdempotency(olderThanMs = 7 * 24 * 3600e3) {
    return this.q.idemPrune.run(new Date(Date.now() - olderThanMs).toISOString()).changes;
  }
}
