// Node-level tests: CRDT merge convergence, text diff helpers, disk store, and the WebSocket sync server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { diffText, mapIndexThroughDelta } from '../src/shared/textdiff.js';
import { RoomStore, encodeFrame } from '../src/server/store.js';
import { startServer } from '../src/server/index.js';
import { parseArgs, defaultDataDir } from '../src/server/config.js';

// deterministic PRNG
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const WORDS = ['中文', '繁體', 'hello', ' ', '\n', '😀', 'Yjs', '任務', 'x'];

function randomEdit(doc, rand) {
  const text = doc.getText('notes');
  const tasks = doc.getArray('tasks');
  const r = rand();
  if (r < 0.5) {
    text.insert(Math.floor(rand() * (text.length + 1)), WORDS[Math.floor(rand() * WORDS.length)]);
  } else if (r < 0.7 && text.length > 0) {
    const i = Math.floor(rand() * text.length);
    text.delete(i, Math.min(text.length - i, 1 + Math.floor(rand() * 3)));
  } else if (r < 0.85) {
    tasks.push([new Y.Map([['text', `t${Math.floor(rand() * 1000)}`], ['done', false]])]);
  } else if (tasks.length) {
    const m = tasks.get(Math.floor(rand() * tasks.length));
    if (rand() < 0.5) m.set('done', !m.get('done')); else tasks.delete(tasks.toArray().indexOf(m), 1);
  }
}

test('three replicas converge after concurrent random edits delivered in random order', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rand = rng(seed);
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    const inbox = docs.map(() => []);
    docs.forEach((d, i) => d.on('update', (u, origin) => {
      if (origin === 'net') return;
      docs.forEach((_, j) => { if (j !== i) inbox[j].push(u); });
    }));
    for (let step = 0; step < 150; step++) {
      randomEdit(docs[Math.floor(rand() * 3)], rand);
      // sometimes deliver a random subset of pending messages, out of order
      if (rand() < 0.3) {
        const j = Math.floor(rand() * 3);
        inbox[j].sort(() => rand() - 0.5);
        const n = Math.floor(rand() * (inbox[j].length + 1));
        for (const u of inbox[j].splice(0, n)) Y.applyUpdate(docs[j], u, 'net');
      }
    }
    for (let j = 0; j < 3; j++) for (const u of inbox[j].splice(0)) Y.applyUpdate(docs[j], u, 'net');
    const snap = d => JSON.stringify({ t: d.getText('notes').toString(), a: d.getArray('tasks').toJSON() });
    assert.equal(snap(docs[0]), snap(docs[1]), `seed ${seed}: doc0 != doc1`);
    assert.equal(snap(docs[1]), snap(docs[2]), `seed ${seed}: doc1 != doc2`);
    // state vectors identical too
    assert.deepEqual(Y.encodeStateVector(docs[0]), Y.encodeStateVector(docs[2]));
  }
});

test('offline edits on both sides merge without losing either edit', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getText('notes').insert(0, '共同的開頭\n');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  // both go offline and edit the same spot
  a.getText('notes').insert(6, 'A離線編輯 ');
  b.getText('notes').insert(6, 'B離線編輯 ');
  b.getText('notes').insert(0, '# ');
  // reconnect: exchange only the missing parts (sync step 1/2)
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
  const ta = a.getText('notes').toString();
  assert.equal(ta, b.getText('notes').toString());
  for (const s of ['A離線編輯', 'B離線編輯', '# 共同的開頭']) assert.ok(ta.includes(s), `missing ${s} in ${ta}`);
});

test('diffText finds a single replace region and never splits surrogate pairs', () => {
  assert.deepEqual(diffText('abc', 'abc'), { index: 0, remove: 0, insert: '' });
  assert.deepEqual(diffText('abc', 'abXc'), { index: 2, remove: 0, insert: 'X' });
  assert.deepEqual(diffText('中文字', '中字'), { index: 1, remove: 1, insert: '' });
  assert.deepEqual(diffText('aaa', 'aaaa'), { index: 3, remove: 0, insert: 'a' });
  const d = diffText('x😀y', 'x😃y'); // shares the high surrogate
  assert.equal(d.index, 1);
  assert.equal(d.insert, '😃');
  for (const [a, b] of [['hello world', 'help world!'], ['', '新'], ['新', ''], ['😀😀', '😀']]) {
    const r = diffText(a, b);
    assert.equal(a.slice(0, r.index) + r.insert + a.slice(r.index + r.remove), b);
  }
});

test('mapIndexThroughDelta shifts indices for inserts/deletes before them', () => {
  assert.equal(mapIndexThroughDelta([{ insert: 'abc' }], 0), 0);
  assert.equal(mapIndexThroughDelta([{ insert: 'abc' }], 0, true), 3);
  assert.equal(mapIndexThroughDelta([{ retain: 2 }, { insert: 'xy' }], 5), 7);
  assert.equal(mapIndexThroughDelta([{ retain: 2 }, { insert: 'xy' }], 1), 1);
  assert.equal(mapIndexThroughDelta([{ retain: 1 }, { delete: 3 }], 6), 3);
  assert.equal(mapIndexThroughDelta([{ retain: 1 }, { delete: 3 }], 2), 1);
  assert.equal(mapIndexThroughDelta([{ delete: 2 }, { retain: 1 }, { insert: 'Z' }], 4), 3);
});

test('RoomStore: append log + compaction + torn tail survive reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'collab-store-'));
  try {
    const d1 = new Y.Doc();
    const s1 = new RoomStore(dir, 'r1', null);
    await s1.load(d1);
    d1.on('update', u => s1.append(u));
    d1.getText('notes').insert(0, '第一行\n');
    d1.getArray('tasks').push([new Y.Map([['text', 'a']])]);
    await s1.queue;
    // reload from log only
    const d2 = new Y.Doc();
    await new RoomStore(dir, 'r1', null).load(d2);
    assert.equal(d2.getText('notes').toString(), '第一行\n');
    // compact, then more appends
    await s1.compact(d1);
    d1.getText('notes').insert(4, '第二行\n');
    await s1.queue;
    const st = await s1.stats();
    assert.ok(st.snapshotBytes > 0 && st.logBytes > 0);
    // simulate a crash mid-write: torn frame at the end
    const junk = encodeFrame(new Uint8Array([1, 2, 3, 4, 5, 6]));
    await appendFile(s1.logPath, junk.subarray(0, 5));
    const d3 = new Y.Doc();
    const r = await new RoomStore(dir, 'r1', null).load(d3);
    assert.equal(r.torn, true);
    assert.equal(d3.getText('notes').toString(), '第一行\n第二行\n');
    assert.equal(d3.getArray('tasks').length, 1);
    assert.equal((await readFile(s1.logPath)).length, 0, 'torn log is compacted away');
    assert.throws(() => new RoomStore(dir, '../evil', null));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('config: OS-aware default data dir and argument parsing', () => {
  assert.equal(defaultDataDir('win32', { ProgramData: 'C:\\ProgramData' }).replace(/\\/g, '/'), 'C:/ProgramData/NewMiscCode/05-crdt-collab');
  assert.match(defaultDataDir('linux', {}), /05-crdt-collab[\\/]data$/);
  const c = parseArgs(['--port', '0', '--data-dir', 'x', '--debug'], {});
  assert.equal(c.port, 0);
  assert.equal(c.debug, true);
  assert.ok(c.logDir.endsWith(join('x', 'logs')));
  assert.throws(() => parseArgs(['--nope'], {}));
});

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('timeout waiting for condition');
}

test('WebSocket server: two Node clients sync, persist, and reload after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'collab-srv-'));
  const cfg = { port: 0, host: '127.0.0.1', dataDir: dir, logDir: join(dir, 'logs'), compactEvery: 5, debug: true, quiet: true };
  let app = await startServer(cfg);
  const mk = (port) => {
    const doc = new Y.Doc();
    const p = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, 'unit', doc, { WebSocketPolyfill: WebSocket, disableBc: true });
    return { doc, p };
  };
  const a = mk(app.port);
  const b = mk(app.port);
  try {
    await until(() => a.p.synced && b.p.synced);
    a.doc.getText('notes').insert(0, 'A寫的');
    b.doc.getText('notes').insert(0, 'B寫的');
    for (let i = 0; i < 7; i++) a.doc.getArray('tasks').push([`task${i}`]); // crosses compactEvery
    await until(() => a.doc.getText('notes').toString() === b.doc.getText('notes').toString() && b.doc.getArray('tasks').length === 7);
    // awareness travels through the server
    a.p.awareness.setLocalStateField('user', { name: 'A', color: '#f00' });
    await until(() => [...b.p.awareness.getStates().values()].some(s => s.user?.name === 'A'));
    const expected = a.doc.getText('notes').toString();
    a.p.destroy(); b.p.destroy(); a.doc.destroy(); b.doc.destroy();
    await app.close();
    // restart on a new port with the same data dir: a fresh client must receive the content
    app = await startServer(cfg);
    const c = mk(app.port);
    await until(() => c.p.synced && c.doc.getText('notes').length > 0);
    assert.equal(c.doc.getText('notes').toString(), expected);
    assert.equal(c.doc.getArray('tasks').length, 7);
    const log = await readFile(app.log.file, 'utf8');
    const events = log.trim().split('\n').map(l => JSON.parse(l).event);
    for (const e of ['server.listening', 'ws.connect', 'doc.update', 'persist.append', 'persist.compact', 'persist.load']) assert.ok(events.includes(e), `log lacks ${e}`);
    c.p.destroy();
    c.doc.destroy();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
