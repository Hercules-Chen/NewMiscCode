// 遮罩測試：秘密絕不寫入錄製檔或日誌。 Secrets never reach recordings or logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startRecorder } from '../src/traffic/proxy.js';
import { makeRedactor, REDACTED } from '../src/traffic/redact.js';
import { Logger } from '../src/env.js';

test('redactor: headers, query, JSON paths (recursive and exact)', () => {
  const r = makeRedactor({ jsonPaths: ['$..password', '$.payment.cardNumber'] });
  assert.deepEqual(r.redactHeaders({ Authorization: 'Bearer x', Accept: 'a' }), { Authorization: REDACTED, Accept: 'a' });
  assert.equal(r.redactUrl('/a?token=abc&x=1'), `/a?token=${encodeURIComponent(REDACTED)}&x=1`);
  assert.deepEqual(r.redactJson({ user: { password: 'p' }, payment: { cardNumber: '4111', amount: 3 }, list: [{ password: 'q' }] }),
    { user: { password: REDACTED }, payment: { cardNumber: REDACTED, amount: 3 }, list: [{ password: REDACTED }] });
});

test('recording proxy never writes secrets to JSONL or logs', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'apiguard-redact-'));
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=SETCOOKIESECRET' });
      res.end(JSON.stringify({ token: 'RESPONSETOKENSECRET', ok: true, payment: { cardNumber: '4111111111111111' } }));
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const logger = new Logger({ dir: join(dir, 'logs'), level: 'debug' });
  const out = join(dir, 'rec.jsonl');
  const rec = await startRecorder({ target: `http://127.0.0.1:${upstream.address().port}`, port: 0, out, logger, redact: { jsonPaths: ['$..password', '$..token', '$.payment.cardNumber'] } });
  try {
    const res = await fetch(`http://127.0.0.1:${rec.port}/login?api_key=QUERYKEYSECRET`, {
      method: 'POST',
      headers: { authorization: 'Bearer AUTHSECRET', cookie: 'c=COOKIESECRET', 'x-api-key': 'APIKEYSECRET', 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'u', password: 'PASSWORDSECRET', nested: { token: 'NESTEDTOKENSECRET' } })
    });
    const body = await res.json();
    assert.equal(body.token, 'RESPONSETOKENSECRET', 'client still receives the real response');
  } finally {
    await rec.close();
    await new Promise(r => upstream.close(r));
    await logger.flush();
  }
  const text = await readFile(out, 'utf8');
  const logs = (await Promise.all((await readdir(join(dir, 'logs'))).map(f => readFile(join(dir, 'logs', f), 'utf8')))).join('\n');
  for (const secret of ['AUTHSECRET', 'COOKIESECRET', 'APIKEYSECRET', 'QUERYKEYSECRET', 'PASSWORDSECRET', 'NESTEDTOKENSECRET', 'RESPONSETOKENSECRET', 'SETCOOKIESECRET', '4111111111111111']) {
    assert.ok(!text.includes(secret), `recording leaked ${secret}`);
    assert.ok(!logs.includes(secret), `log leaked ${secret}`);
  }
  const line = JSON.parse(text.trim());
  assert.equal(line.request.headers.authorization, REDACTED);
  assert.equal(line.request.body.value.user, 'u');
  assert.equal(line.response.body.value.ok, true);
  assert.match(logs, /"level":"debug"/);
  await rm(dir, { recursive: true, force: true });
});
