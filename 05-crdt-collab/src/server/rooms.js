// Room = one shared Y.Doc + awareness + the WebSocket connections editing it.
// Implements the y-protocols wire format used by the y-websocket client:
//   varUint messageType (0 = sync, 1 = awareness, 3 = query awareness) + payload
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { RoomStore } from './store.js';

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const MSG_QUERY_AWARENESS = 3;

const PING_MS = 30000;
let connSeq = 0;

class Room {
  constructor(name, manager) {
    this.name = name;
    this.manager = manager;
    this.log = manager.log;
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null); // the server has no presence of its own
    this.conns = new Map(); // ws -> { id, clientIds:Set }
    this.store = new RoomStore(manager.dataDir, name, manager.log);
    this.updatesSinceCompact = 0;
    this.closing = null;
  }

  async init() {
    await this.store.load(this.doc);
    this.doc.on('update', (update, origin) => this.onUpdate(update, origin));
    this.awareness.on('update', (changes, origin) => this.onAwareness(changes, origin));
  }

  onUpdate(update, origin) {
    const from = this.conns.get(origin)?.id ?? (typeof origin === 'string' ? origin : 'server');
    this.log.debug('doc.update', { room: this.name, bytes: update.length, from, docBytes: this.manager.debugDocSize ? Y.encodeStateAsUpdate(this.doc).length : undefined });
    this.manager.stats.updates++;
    this.manager.stats.updateBytes += update.length;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const ws of this.conns.keys()) if (ws !== origin) this.send(ws, msg);
    this.store.append(update);
    if (++this.updatesSinceCompact >= this.manager.compactEvery) {
      this.updatesSinceCompact = 0;
      this.store.compact(this.doc);
    }
  }

  onAwareness({ added, updated, removed }, origin) {
    const changed = added.concat(updated, removed);
    const meta = this.conns.get(origin);
    if (meta) {
      for (const id of added) meta.clientIds.add(id);
      for (const id of removed) meta.clientIds.delete(id);
    }
    this.log.debug('awareness.update', { room: this.name, added: added.length, updated: updated.length, removed: removed.length, from: meta?.id });
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    const msg = encoding.toUint8Array(enc);
    for (const ws of this.conns.keys()) this.send(ws, msg);
  }

  send(ws, msg) {
    if (ws.readyState !== 1 /* OPEN */) return;
    ws.send(msg, err => { if (err) { this.log.warn('ws.send_failed', { room: this.name, error: err.message }); ws.terminate(); } });
  }

  addConn(ws, meta) {
    meta.clientIds = new Set();
    this.conns.set(ws, meta);
    // sync step 1 (our state vector) - the client answers with what we are missing
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(ws, encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      this.send(ws, encoding.toUint8Array(a));
    }
  }

  handleMessage(ws, data) {
    const buf = new Uint8Array(data);
    const meta = this.conns.get(ws);
    try {
      const dec = decoding.createDecoder(buf);
      const enc = encoding.createEncoder();
      const type = decoding.readVarUint(dec);
      switch (type) {
        case MSG_SYNC: {
          encoding.writeVarUint(enc, MSG_SYNC);
          const step = syncProtocol.readSyncMessage(dec, enc, this.doc, ws);
          this.log.debug('ws.sync', { room: this.name, conn: meta?.id, step, bytes: buf.length });
          if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
          break;
        }
        case MSG_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws);
          break;
        case MSG_QUERY_AWARENESS: {
          encoding.writeVarUint(enc, MSG_AWARENESS);
          encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]));
          this.send(ws, encoding.toUint8Array(enc));
          break;
        }
        default:
          this.log.warn('ws.unknown_message', { room: this.name, conn: meta?.id, type });
      }
    } catch (err) {
      this.log.error('ws.message_error', { room: this.name, conn: meta?.id, error: String(err?.stack || err) });
    }
  }

  removeConn(ws) {
    const meta = this.conns.get(ws);
    if (!meta) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...meta.clientIds], null);
  }
}

export class RoomManager {
  constructor({ dataDir, log, compactEvery = 200 }) {
    this.dataDir = dataDir;
    this.log = log;
    this.compactEvery = compactEvery;
    this.debugDocSize = log.isDebug;
    this.rooms = new Map(); // name -> Promise<Room>
    this.stats = { connections: 0, updates: 0, updateBytes: 0 };
  }

  getRoom(name) {
    let p = this.rooms.get(name);
    if (!p) {
      const room = new Room(name, this);
      p = room.init().then(() => room);
      p.catch(() => this.rooms.delete(name));
      this.rooms.set(name, p);
    }
    return p;
  }

  /** Called for each new WebSocket on /ws/<room> */
  handleConnection(ws, name, remote) {
    const meta = { id: `c${++connSeq}`, remote };
    this.stats.connections++;
    this.log.info('ws.connect', { room: name, conn: meta.id, remote });
    const backlog = [];
    let room = null;
    ws.binaryType = 'arraybuffer';
    ws.on('message', data => (room ? room.handleMessage(ws, data) : backlog.push(data)));
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const timer = setInterval(() => {
      if (!alive) { this.log.warn('ws.timeout', { room: name, conn: meta.id }); ws.terminate(); return; }
      alive = false;
      try { ws.ping(); } catch { /* closed */ }
    }, PING_MS);
    ws.on('close', (code) => {
      clearInterval(timer);
      this.log.info('ws.close', { room: name, conn: meta.id, code });
      if (room) {
        room.removeConn(ws);
        if (room.conns.size === 0) this.releaseRoom(room);
      }
    });
    ws.on('error', err => this.log.warn('ws.error', { room: name, conn: meta.id, error: err.message }));

    this.getRoom(name).then(r => {
      if (ws.readyState > 1) return; // closed while loading
      room = r;
      room.addConn(ws, meta);
      for (const d of backlog) room.handleMessage(ws, d);
      backlog.length = 0;
    }, err => {
      this.log.error('room.load_failed', { room: name, error: String(err?.stack || err) });
      ws.close(1011, 'room load failed');
    });
  }

  /** Last client left: compact to a snapshot, then unload after a grace period. */
  releaseRoom(room) {
    room.store.compact(room.doc);
    room.updatesSinceCompact = 0;
    clearTimeout(room.unloadTimer);
    room.unloadTimer = setTimeout(async () => {
      if (room.conns.size > 0) return;
      this.rooms.delete(room.name);
      await room.store.queue;
      room.awareness.destroy();
      room.doc.destroy();
      this.log.info('room.unload', { room: room.name });
    }, 30000);
    room.unloadTimer.unref?.();
  }

  async roomStats(name) {
    const loaded = this.rooms.has(name);
    const room = await this.getRoom(name);
    const s = await room.store.stats();
    return { room: name, loaded, connections: room.conns.size, presence: room.awareness.getStates().size, docBytes: Y.encodeStateAsUpdate(room.doc).length, ...s };
  }

  /** Flush every loaded room to a snapshot (graceful shutdown). */
  async flushAll({ unload = false } = {}) {
    for (const [name, p] of [...this.rooms.entries()]) {
      const room = await p.catch(() => null);
      if (!room) continue;
      await room.store.compact(room.doc);
      if (unload) {
        clearTimeout(room.unloadTimer);
        this.rooms.delete(name);
        room.awareness.destroy(); // stops its internal timer
        room.doc.destroy();
      }
    }
  }
}
