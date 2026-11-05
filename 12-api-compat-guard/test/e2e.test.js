// 端對端：啟動 v1/v2 示範服務 → CLI record（代理）→ 送流量 → CLI replay → 驗證結果與結束代碼。
// End-to-end via the real CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { startOldApi } from '../demo/old-api/server.js';
import { startNewApi } from '../demo/new-api/server.js';
import { sendDemoTraffic, DEMO_SECRET_TOKEN, DEMO_PASSWORD } from '../demo/traffic.js';
import { startMock } from '../src/mock/server.js';
import { loadSpec } from '../src/openapi/load.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'src', 'cli.js');
const CFG = join(ROOT, 'demo', 'apiguard.config.json');

function run(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, NO_COLOR: '1', ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out, err }));
  });
}

test('CLI diff: exit codes for breaking / identical / --fail-on none / bad input', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'apiguard-e2e-'));
  try {
    const v1 = join(ROOT, 'demo/openapi-v1.yaml'), v2 = join(ROOT, 'demo/openapi-v2.yaml');
    const r1 = await run(['diff', v1, v2, '--data-dir', dir, '--out', join(dir, 'd.json')]);
    assert.equal(r1.code, 1, r1.err);
    const rep = JSON.parse(await readFile(join(dir, 'd.json'), 'utf8'));
    assert.deepEqual(rep.summary, { BREAKING: 14, NON_BREAKING: 11, INFO: 1 });
    assert.equal((await run(['diff', v1, v1, '--data-dir', dir])).code, 0);
    assert.equal((await run(['diff', v1, v2, '--fail-on', 'none', '--data-dir', dir])).code, 0);
    const bad = await run(['diff', v1, join(dir, 'missing.yaml'), '--data-dir', dir]);
    assert.equal(bad.code, 2);
    const md = await run(['diff', v1, v2, '--lang', 'en', '--data-dir', dir, '--out', join(dir, 'd.md')]);
    assert.match(md.out, /Breaking: 14/);
    assert.match(await readFile(join(dir, 'd.md'), 'utf8'), /\| `RESPONSE_TYPE_CHANGED` \|/);
    assert.equal((await run([])).code, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('record through proxy (CLI) then replay to new service (CLI)', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'apiguard-e2e-'));
  const oldApi = await startOldApi(0), newApi = await startNewApi(0);
  try {
    const recFile = join(dir, 'rec.jsonl');
    const proc = spawn(process.execPath, [CLI, 'record', '--target', oldApi.url, '--port', '0', '--out', recFile, '--config', CFG, '--data-dir', dir], { cwd: ROOT });
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stdout.on('data', d => { buf += d; const m = /127\.0\.0\.1:(\d+)/.exec(buf); if (m) resolve(Number(m[1])); });
      proc.on('close', c => reject(new Error('recorder exited ' + c)));
    });
    const results = await sendDemoTraffic(`http://127.0.0.1:${port}`);
    assert.deepEqual(results.map(r => r.status), [200, 200, 200, 200, 200, 201, 200, 204], 'old API behaves through the proxy');
    const closed = new Promise(r => proc.on('close', r));
    proc.kill('SIGINT');
    assert.equal(await closed, 0);

    const recText = await readFile(recFile, 'utf8');
    assert.equal(recText.trim().split('\n').length, 8);
    assert.ok(!recText.includes(DEMO_SECRET_TOKEN.split(' ')[1]) && !recText.includes(DEMO_PASSWORD) && !recText.includes('abc123secret'), 'no secrets in recordings');

    const out = join(dir, 'replay.json');
    const r = await run(['replay', recFile, '--to', newApi.url, '--config', CFG, '--data-dir', dir, '--out', out], { APIGUARD_REPLAY_TOKEN: 't' });
    assert.equal(r.code, 1, r.err + r.out);
    const rep = JSON.parse(await readFile(out, 'utf8'));
    const key = f => `${f.rule} ${f.location} ${f.field}`;
    const keys = new Set(rep.findings.map(key));
    for (const k of [
      'TYPE_CHANGED GET /orders/ord-1001 $.total',
      'FIELD_MISSING GET /orders/ord-1001 $.customerName',
      'FIELD_MISSING GET /orders/ord-1002 $.note',
      'ARRAY_LENGTH_CHANGED GET /orders?limit=1 $.items',
      'STATUS_CHANGED POST /orders status',
      'STATUS_CHANGED DELETE /orders/ord-1002 status',
      'STATUS_CHANGED GET /orders?status=cancelled status',
      'FIELD_ADDED GET /orders/ord-1001 $.currency'
    ]) assert.ok(keys.has(k), `expected ${k}`);
    // 忽略規則生效：createdAt 格式不同但同時間、/health 與 /login 相容
    assert.ok(![...keys].some(k => k.startsWith('VALUE_CHANGED') && k.includes('createdAt')), 'createdAt differences ignored');
    const ok = rep.exchanges.filter(x => x.severity === 'OK').map(x => x.url);
    assert.deepEqual(ok, ['/health', '/login']);
    assert.deepEqual(rep.summary, { BREAKING: 15, NON_BREAKING: 9, INFO: 0 });

    // 新服務如果跟舊的一樣 -> exit 0
    const old2 = await startOldApi(0);
    const same = await run(['replay', recFile, '--to', old2.url, '--config', CFG, '--data-dir', dir], { APIGUARD_REPLAY_TOKEN: 't' });
    await old2.close();
    assert.equal(same.code, 0, same.out);
  } finally {
    await oldApi.close(); await newApi.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('mock server answers from OpenAPI examples', async () => {
  const spec = await loadSpec(join(ROOT, 'demo/openapi-v2.yaml'));
  const m = await startMock(spec.doc, { port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${m.port}/orders/abc`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.total, '1250.50');
    assert.equal(b.customer.name, '王小明');
    const p = await fetch(`http://127.0.0.1:${m.port}/orders`, { method: 'POST', body: '{}' });
    assert.equal(p.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${m.port}/nope`)).status, 404);
  } finally { await m.close(); }
});
