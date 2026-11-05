// 環境（資料夾/語言/日誌）與報告輸出測試。 Env + report renderer tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { defaultDataDir, detectLang, Logger } from '../src/env.js';
import { buildReport, renderHtml, renderMarkdown, renderConsole } from '../src/report/render.js';
import { parseArgs } from '../src/cli.js';

test('default data dir is OS-aware and overridable', () => {
  assert.equal(defaultDataDir('win32', { ProgramData: 'C:\\ProgramData' }), join('C:\\ProgramData', 'NewMiscCode', '12-api-compat-guard'));
  assert.match(defaultDataDir('linux', {}), /12-api-compat-guard[\\/]data$/);
  assert.match(defaultDataDir('linux', { APIGUARD_DATA_DIR: '/tmp/x' }), /[\\/]tmp[\\/]x$/);
});

test('language detection defaults to zh-TW', () => {
  assert.equal(detectLang(undefined, {}), 'zh-TW');
  assert.equal(detectLang('en', {}), 'en');
  assert.equal(detectLang(undefined, { APIGUARD_LANG: 'en-US' }), 'en');
});

test('logger writes JSONL with levels and scrubs secret keys', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'apiguard-log-'));
  const log = new Logger({ dir, level: 'info' });
  log.debug('hidden');
  log.info('hello', { authorization: 'Bearer LEAK', nested: { password: 'LEAK2' }, ok: 1 });
  log.error('boom', { error: 'x' });
  await log.flush();
  const lines = (await readFile(log.file, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => l.level), ['info', 'error']);
  assert.equal(lines[0].data.authorization, '***');
  assert.ok(!JSON.stringify(lines).includes('LEAK'));
  await rm(dir, { recursive: true, force: true });
});

test('renderers: html escapes </script>, md and console contain counts', () => {
  const f = { rule: 'RESPONSE_FIELD_REMOVED', severity: 'BREAKING', location: 'GET /x', field: '</script><b>', message: { 'zh-TW': '回應欄位 </script> 已移除', en: 'removed </script>' } };
  const r = buildReport({ kind: 'diff', findings: [f], inputs: { old: 'a', new: 'b' }, lang: 'zh-TW' });
  const html = renderHtml(r, 'zh-TW');
  assert.equal(html.match(/<\/script>/g).length, 3, 'only the real closing tags');
  assert.match(renderMarkdown(r, 'en'), /\| 1 \| 0 \| 0 \|/);
  assert.match(renderConsole(r, 'zh-TW', { color: false }), /破壞性: 1/);
});

test('arg parser handles flags, values, = form', () => {
  const p = parseArgs(['replay', 'r.jsonl', '--to=http://x', '--debug', '--header', 'A: b', '--port', '0']);
  assert.equal(p.cmd, 'replay');
  assert.deepEqual(p.pos, ['r.jsonl']);
  assert.equal(p.opt.to, 'http://x');
  assert.equal(p.opt.debug, true);
  assert.equal(p.opt.header, 'A: b');
  assert.equal(p.opt.port, '0');
});
