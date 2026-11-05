// SQLite storage (better-sqlite3). The driver is synchronous; the store exposes an async API
// so callers stay async and the driver can be swapped (e.g. node:sqlite or a remote DB) later.
import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  webauthn_user_id TEXT NOT NULL UNIQUE,      -- base64url user handle (random 32 bytes), never the username
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  id              TEXT PRIMARY KEY,           -- credentialID, base64url
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key      BLOB NOT NULL,              -- COSE_Key bytes
  counter         INTEGER NOT NULL DEFAULT 0, -- signature counter (0 = authenticator does not count)
  transports      TEXT NOT NULL DEFAULT '[]', -- JSON array, e.g. ["internal","hybrid"]
  aaguid          TEXT,
  fmt             TEXT,                       -- attestation format (we request 'none')
  device_type     TEXT,                       -- singleDevice | multiDevice
  backup_eligible INTEGER NOT NULL DEFAULT 0, -- BE flag
  backed_up       INTEGER NOT NULL DEFAULT 0, -- BS flag (latest seen)
  uv_initialized  INTEGER NOT NULL DEFAULT 0,
  name            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
CREATE TABLE IF NOT EXISTS challenges (
  flow_id     TEXT NOT NULL,                  -- random id held in an HttpOnly cookie
  purpose     TEXT NOT NULL,                  -- register | login
  challenge   TEXT NOT NULL,
  user_id     INTEGER,
  pending     TEXT,                           -- JSON (e.g. new user's username/displayName)
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (flow_id, purpose)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,               -- sha256(token); the raw token only lives in the cookie
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT,
  created_at  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  user_id     INTEGER,
  username    TEXT,
  event       TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  credential_id TEXT,
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, id);
`;

const now = () => new Date().toISOString();

export async function openStore(dataDir, { file = 'passkeys.sqlite' } = {}) {
  let path = ':memory:';
  if (dataDir !== ':memory:') {
    await mkdir(dataDir, { recursive: true });
    path = join(dataDir, file);
  }
  const db = new Database(path);
  db.exec(SCHEMA);

  const toCred = r => r && ({
    id: r.id, userId: r.user_id, publicKey: new Uint8Array(r.public_key), counter: r.counter,
    transports: JSON.parse(r.transports || '[]'), aaguid: r.aaguid, fmt: r.fmt, deviceType: r.device_type,
    backupEligible: !!r.backup_eligible, backedUp: !!r.backed_up, uvInitialized: !!r.uv_initialized,
    name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at,
  });
  const toUser = r => r && ({ id: r.id, username: r.username, displayName: r.display_name, webauthnUserId: r.webauthn_user_id, createdAt: r.created_at });

  const st = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByHandle: db.prepare('SELECT * FROM users WHERE webauthn_user_id = ?'),
    insUser: db.prepare('INSERT INTO users (username, display_name, webauthn_user_id, created_at) VALUES (?, ?, ?, ?)'),
    credById: db.prepare('SELECT * FROM credentials WHERE id = ?'),
    credsByUser: db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at'),
    insCred: db.prepare(`INSERT INTO credentials (id, user_id, public_key, counter, transports, aaguid, fmt, device_type,
      backup_eligible, backed_up, uv_initialized, name, created_at) VALUES (@id, @userId, @publicKey, @counter, @transports,
      @aaguid, @fmt, @deviceType, @backupEligible, @backedUp, @uvInitialized, @name, @createdAt)`),
    updCredUse: db.prepare('UPDATE credentials SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?'),
    renameCred: db.prepare('UPDATE credentials SET name = ? WHERE id = ? AND user_id = ?'),
    delCred: db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?'),
    putChallenge: db.prepare(`INSERT OR REPLACE INTO challenges (flow_id, purpose, challenge, user_id, pending, expires_at) VALUES (?, ?, ?, ?, ?, ?)`),
    getChallenge: db.prepare('SELECT * FROM challenges WHERE flow_id = ? AND purpose = ?'),
    delChallenge: db.prepare('DELETE FROM challenges WHERE flow_id = ? AND purpose = ?'),
    purgeChallenges: db.prepare('DELETE FROM challenges WHERE expires_at < ?'),
    insSession: db.prepare('INSERT INTO sessions (token_hash, user_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    getSession: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    insAudit: db.prepare(`INSERT INTO audit_log (ts, user_id, username, event, ok, credential_id, detail, ip, user_agent)
      VALUES (@ts, @userId, @username, @event, @ok, @credentialId, @detail, @ip, @userAgent)`),
    auditByUser: db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
    auditAll: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'),
  };

  return {
    path,
    async getUserByName(username) { return toUser(st.userByName.get(username)); },
    async getUserById(id) { return toUser(st.userById.get(id)); },
    async getUserByHandle(handle) { return toUser(st.userByHandle.get(handle)); },
    async createUserWithCredential(user, cred) {
      // one transaction: a user row never exists without its first passkey
      const tx = db.transaction(() => {
        const info = st.insUser.run(user.username, user.displayName, user.webauthnUserId, now());
        st.insCred.run(credRow({ ...cred, userId: info.lastInsertRowid }));
        return Number(info.lastInsertRowid);
      });
      return tx();
    },
    async addCredential(cred) { st.insCred.run(credRow(cred)); },
    async getCredential(id) { return toCred(st.credById.get(id)); },
    async listCredentials(userId) { return st.credsByUser.all(userId).map(toCred); },
    async updateCredentialUse(id, counter, backedUp) { st.updCredUse.run(counter, backedUp ? 1 : 0, now(), id); },
    async renameCredential(userId, id, name) { return st.renameCred.run(name, id, userId).changes > 0; },
    async deleteCredential(userId, id) { return st.delCred.run(id, userId).changes > 0; },
    async putChallenge(flowId, purpose, challenge, { userId = null, pending = null, ttlMs }) {
      st.purgeChallenges.run(Date.now());
      st.putChallenge.run(flowId, purpose, challenge, userId, pending ? JSON.stringify(pending) : null, Date.now() + ttlMs);
    },
    /** Single-use: the row is deleted on read. Returns null if missing or expired. */
    async takeChallenge(flowId, purpose) {
      const r = st.getChallenge.get(flowId, purpose);
      if (!r) return null;
      st.delChallenge.run(flowId, purpose);
      if (r.expires_at < Date.now()) return { expired: true };
      return { challenge: r.challenge, userId: r.user_id, pending: r.pending ? JSON.parse(r.pending) : null };
    },
    async createSession(tokenHash, userId, credentialId, ttlMs) {
      st.purgeSessions.run(Date.now());
      st.insSession.run(tokenHash, userId, credentialId, now(), Date.now() + ttlMs);
    },
    async getSession(tokenHash) { return st.getSession.get(tokenHash, Date.now()) || null; },
    async deleteSession(tokenHash) { st.delSession.run(tokenHash); },
    async audit(e) {
      st.insAudit.run({ ts: now(), userId: e.userId ?? null, username: e.username ?? null, event: e.event, ok: e.ok ? 1 : 0,
        credentialId: e.credentialId ?? null, detail: e.detail ?? null, ip: e.ip ?? null, userAgent: e.userAgent ? String(e.userAgent).slice(0, 200) : null });
    },
    async listAudit(userId, limit = 50) {
      const rows = userId == null ? st.auditAll.all(limit) : st.auditByUser.all(userId, limit);
      return rows.map(r => ({ id: r.id, ts: r.ts, event: r.event, ok: !!r.ok, username: r.username, credentialId: r.credential_id, detail: r.detail, ip: r.ip, userAgent: r.user_agent }));
    },
    async close() { db.close(); },
  };

  function credRow(c) {
    return { id: c.id, userId: c.userId, publicKey: Buffer.from(c.publicKey), counter: c.counter ?? 0,
      transports: JSON.stringify(c.transports ?? []), aaguid: c.aaguid ?? null, fmt: c.fmt ?? null, deviceType: c.deviceType ?? null,
      backupEligible: c.backupEligible ? 1 : 0, backedUp: c.backedUp ? 1 : 0, uvInitialized: c.uvInitialized ? 1 : 0,
      name: c.name, createdAt: now() };
  }
}
