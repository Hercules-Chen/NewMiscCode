// Server unit/integration tests: idempotency, conflicts, validation, static + SW build id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { parseArgs, defaultDataDir } from '../src/config.js';

let app, base, dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwa08-unit-'));
  app = await createApp({ dataDir: dir, logDir: join(dir, 'logs'), debug: true, logToConsole: false });
  base = await app.listen(0);
});
after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });

const api = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json(), headers: r.headers };
};

test('create is idempotent: same key replayed 3x -> exactly one row, identical response', async () => {
  const body = { id: 'rec-idem-0001', title: '消防栓壓力', status: 'ok', note: 'n' };
  const a = await api('POST', '/api/records', body, { 'Idempotency-Key': 'key-create-0001' });
  const b = await api('POST', '/api/records', body, { 'Idempotency-Key': 'key-create-0001' });
  const c = await api('POST', '/api/records', body, { 'Idempotency-Key': 'key-create-0001' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(c.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(b.body, a.body);
  const list = await api('GET', '/api/records');
  assert.equal(list.body.records.filter(r => r.id === 'rec-idem-0001').length, 1);
  assert.equal(app.store.count(), 1);
});

test('concurrent duplicate requests with the same key do not duplicate', async () => {
  const body = { id: 'rec-idem-0002', title: '並行測試' };
  const rs = await Promise.all(Array.from({ length: 8 }, () => api('POST', '/api/records', body, { 'Idempotency-Key': 'key-create-0002' })));
  assert.ok(rs.every(r => r.status === 201));
  assert.equal(new Set(rs.map(r => JSON.stringify(r.body))).size, 1);
  assert.equal(app.store.list().filter(r => r.id === 'rec-idem-0002').length, 1);
});

test('update replay with same key does not bump version twice', async () => {
  const k = { 'Idempotency-Key': 'key-update-0001' };
  const u1 = await api('PUT', '/api/records/rec-idem-0001', { title: '改過', baseVersion: 1 }, k);
  const u2 = await api('PUT', '/api/records/rec-idem-0001', { title: '改過', baseVersion: 1 }, k);
  assert.equal(u1.status, 200);
  assert.equal(u1.body.record.version, 2);
  assert.equal(u2.status, 200, 'replay returns stored 200, not a 409');
  assert.equal(u2.body.record.version, 2);
  assert.equal(app.store.get('rec-idem-0001').version, 2);
});

test('same key with a different payload is rejected (422)', async () => {
  const r = await api('PUT', '/api/records/rec-idem-0001', { title: '別的內容', baseVersion: 2 }, { 'Idempotency-Key': 'key-update-0001' });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'idempotency_key_reused');
});

test('stale baseVersion -> 409 with server copy; rebase then succeeds', async () => {
  const r = await api('PUT', '/api/records/rec-idem-0001', { title: '舊版本修改', baseVersion: 1 }, { 'Idempotency-Key': 'key-conflict-01' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'conflict');
  assert.equal(r.body.server.version, 2);
  assert.equal(r.body.server.title, '改過');
  // replaying the conflicting request returns the same 409 (stored), never applies it
  const again = await api('PUT', '/api/records/rec-idem-0001', { title: '舊版本修改', baseVersion: 1 }, { 'Idempotency-Key': 'key-conflict-01' });
  assert.equal(again.status, 409);
  // "keep mine": new key, baseVersion = server version
  const ok = await api('PUT', '/api/records/rec-idem-0001', { title: '舊版本修改', baseVersion: 2 }, { 'Idempotency-Key': 'key-conflict-02' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.record.version, 3);
  assert.equal(ok.body.record.title, '舊版本修改');
});

test('create with existing id but new key -> 409', async () => {
  const r = await api('POST', '/api/records', { id: 'rec-idem-0001', title: 'dup' }, { 'Idempotency-Key': 'key-create-dupe' });
  assert.equal(r.status, 409);
  assert.equal(r.body.server.id, 'rec-idem-0001');
});

test('delete is a versioned soft delete (tombstone in list)', async () => {
  const d = await api('DELETE', '/api/records/rec-idem-0002', { baseVersion: 1 }, { 'Idempotency-Key': 'key-delete-0001' });
  assert.equal(d.status, 200);
  assert.equal(d.body.record.deleted, true);
  assert.equal(d.body.record.version, 2);
  const list = await api('GET', '/api/records');
  assert.equal(list.body.records.find(r => r.id === 'rec-idem-0002').deleted, true);
  assert.equal(app.store.count(), 1);
});

test('validation errors are 400 and not remembered by idempotency', async () => {
  const k = { 'Idempotency-Key': 'key-invalid-001' };
  const bad = await api('POST', '/api/records', { id: 'rec-valid-0001', title: '' }, k);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'title_required');
  const bad2 = await api('POST', '/api/records', { id: 'rec-valid-0001', title: 'x', status: 'nope' }, { 'Idempotency-Key': 'key-invalid-002' });
  assert.equal(bad2.body.error, 'bad_status');
  const noBase = await api('PUT', '/api/records/rec-idem-0001', { title: 'x' }, { 'Idempotency-Key': 'key-invalid-003' });
  assert.equal(noBase.body.error, 'base_version_required');
  const notFound = await api('PUT', '/api/records/nope-nope-nope', { title: 'x', baseVersion: 1 });
  assert.equal(notFound.status, 404);
  const badJson = await fetch(base + '/api/records', { method: 'POST', body: '{oops' });
  assert.equal(badJson.status, 400);
});

test('static files, SW build id injection, manifest, path traversal', async () => {
  const sw = await fetch(base + '/sw.js');
  const swText = await sw.text();
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('cache-control'), /no-cache/);
  assert.ok(swText.includes(`'${app.buildId}'`), 'build id injected');
  assert.ok(!swText.includes("'__BUILD_ID__'"));
  app.setBuildId('test-build-2');
  assert.ok((await (await fetch(base + '/sw.js')).text()).includes("'test-build-2'"));
  const man = await fetch(base + '/manifest.webmanifest');
  assert.match(man.headers.get('content-type'), /manifest\+json/);
  const m = await man.json();
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
  const idx = await fetch(base + '/');
  assert.match(await idx.text(), /<html lang="zh-TW">/);
  const trav = await fetch(base + '/..%2fpackage.json');
  assert.ok([403, 404].includes(trav.status));
  const health = await api('GET', '/api/health');
  assert.equal(health.body.ok, true);
});

test('JSONL log file is written with levels', async () => {
  const files = await readdir(join(dir, 'logs'));
  assert.ok(files.some(f => /^server-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)));
  const text = await readFile(join(dir, 'logs', files[0]), 'utf8');
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.some(l => l.level === 'debug' && l.msg === 'http'));
  assert.ok(lines.some(l => l.level === 'info' && l.msg === 'mutation'));
});

test('config: OS-aware default data dir and flags', () => {
  assert.equal(defaultDataDir('win32', { ProgramData: 'C:\\ProgramData' }), join('C:\\ProgramData', 'NewMiscCode', '08-pwa-offline-sync'));
  assert.match(defaultDataDir('linux', {}), /08-pwa-offline-sync[\\/]data$/);
  const c = parseArgs(['--port', '0', '--debug', '--data-dir', dir], {});
  assert.equal(c.port, 0); assert.equal(c.debug, true); assert.equal(c.logDir, join(dir, 'logs'));
  assert.throws(() => parseArgs(['--bogus'], {}));
});
