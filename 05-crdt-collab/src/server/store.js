// Disk persistence without a database:
//   <dataDir>/rooms/<room>/snapshot.bin   full state (Y.encodeStateAsUpdate), replaced atomically
//   <dataDir>/rooms/<room>/updates.log    append-only log: [uint32 LE length][update bytes]...
//   <dataDir>/rooms/<room>/versions/      named versions (index.json + <id>.bin)
// Loading = apply snapshot, then replay every complete log frame (a torn last frame is ignored).
// Replaying an update twice is harmless: Yjs updates are idempotent.
import { mkdir, readFile, writeFile, appendFile, rename, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as Y from 'yjs';

export const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

const exists = p => stat(p).then(() => true, () => false);
const fileSize = p => stat(p).then(s => s.size, () => 0);

export function encodeFrame(update) {
  const frame = new Uint8Array(4 + update.length);
  new DataView(frame.buffer).setUint32(0, update.length, true);
  frame.set(update, 4);
  return frame;
}

export function decodeFrames(buf) {
  const out = [];
  let off = 0;
  let torn = false;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (off + 4 <= buf.length) {
    const len = view.getUint32(off, true);
    if (off + 4 + len > buf.length) { torn = true; break; }
    out.push(buf.subarray(off + 4, off + 4 + len));
    off += 4 + len;
  }
  if (off < buf.length) torn = true;
  return { updates: out, torn };
}

export class RoomStore {
  constructor(dataDir, room, log) {
    if (!ROOM_RE.test(room)) throw new Error(`invalid room name: ${room}`);
    this.room = room;
    this.dir = join(dataDir, 'rooms', room);
    this.snapshotPath = join(this.dir, 'snapshot.bin');
    this.logPath = join(this.dir, 'updates.log');
    this.versionsDir = join(this.dir, 'versions');
    this.log = log;
    this.queue = Promise.resolve();
    this.pendingFrames = 0; // frames in updates.log since the last compaction
  }

  /** serialize all disk writes of this room */
  enqueue(fn) {
    const p = this.queue.then(fn);
    this.queue = p.catch(err => this.log?.error('persist.error', { room: this.room, error: String(err?.stack || err) }));
    return p;
  }

  async load(doc) {
    await mkdir(this.dir, { recursive: true });
    let snapBytes = 0;
    if (await exists(this.snapshotPath)) {
      const snap = await readFile(this.snapshotPath);
      snapBytes = snap.length;
      if (snap.length) Y.applyUpdate(doc, snap, 'store');
    }
    let frames = 0;
    let torn = false;
    if (await exists(this.logPath)) {
      const buf = await readFile(this.logPath);
      const r = decodeFrames(buf);
      torn = r.torn;
      for (const u of r.updates) Y.applyUpdate(doc, u, 'store');
      frames = r.updates.length;
    }
    this.pendingFrames = frames;
    this.log?.info('persist.load', { room: this.room, snapshotBytes: snapBytes, logFrames: frames, tornTail: torn });
    if (torn) await this.compact(doc); // rewrite a clean state
    return { snapshotBytes: snapBytes, logFrames: frames, torn };
  }

  append(update) {
    return this.enqueue(async () => {
      await appendFile(this.logPath, encodeFrame(update));
      this.pendingFrames++;
      this.log?.debug('persist.append', { room: this.room, bytes: update.length, logFrames: this.pendingFrames });
    });
  }

  compact(doc) {
    return this.enqueue(async () => {
      const state = Y.encodeStateAsUpdate(doc);
      const tmp = this.snapshotPath + '.tmp';
      await writeFile(tmp, state);
      await rename(tmp, this.snapshotPath);
      await writeFile(this.logPath, new Uint8Array(0));
      const frames = this.pendingFrames;
      this.pendingFrames = 0;
      this.log?.info('persist.compact', { room: this.room, snapshotBytes: state.length, mergedFrames: frames });
    });
  }

  async stats() {
    return {
      snapshotBytes: await fileSize(this.snapshotPath),
      logBytes: await fileSize(this.logPath),
      logFrames: this.pendingFrames
    };
  }

  // ---- named versions -------------------------------------------------
  async listVersions() {
    try {
      return JSON.parse(await readFile(join(this.versionsDir, 'index.json'), 'utf8'));
    } catch {
      return [];
    }
  }

  saveVersion(doc, label, author) {
    return this.enqueue(async () => {
      await mkdir(this.versionsDir, { recursive: true });
      const list = await this.listVersions();
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const state = Y.encodeStateAsUpdate(doc);
      await writeFile(join(this.versionsDir, `${id}.bin`), state);
      const entry = { id, label: String(label || '').slice(0, 80), author: String(author || '').slice(0, 40), createdAt: new Date().toISOString(), bytes: state.length };
      list.unshift(entry);
      const tmp = join(this.versionsDir, 'index.json.tmp');
      await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
      await rename(tmp, join(this.versionsDir, 'index.json'));
      this.log?.info('version.save', { room: this.room, id, bytes: state.length });
      return entry;
    });
  }

  async readVersion(id) {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return null;
    try { return await readFile(join(this.versionsDir, `${id}.bin`)); } catch { return null; }
  }

  async destroyAll() {
    await rm(this.dir, { recursive: true, force: true });
  }
}
