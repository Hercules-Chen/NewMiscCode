// Unit tests: i18n parity, argument parsing, CLI usage / exit codes, local validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, t, normalizeLang, toolbarStrings } from '../src/i18n.js';
import { parseArgs, resolveOptions } from '../src/config.js';
import { localValidate } from '../src/validate.js';
import { redact } from '../src/recorder.js';
import { runNode } from './helpers.js';

test('zh-TW and en have the same message keys', () => {
  assert.deepEqual(Object.keys(MESSAGES['zh-TW']).sort(), Object.keys(MESSAGES.en).sort());
  assert.equal(normalizeLang('EN-us'), 'en');
  assert.equal(normalizeLang('zh'), 'zh-TW');
  assert.equal(t('en', 'cli.saved', { count: 3, file: 'a.json' }), 'Scenario saved (3 steps): a.json');
  assert.equal(toolbarStrings()['zh-TW'].stop, '停止並儲存');
});

test('argument parsing and defaults', () => {
  const a = parseArgs(['record', 'http://x/', '--out', 'a.json', '--debug', '--lang=en', '--script', 's.js']);
  assert.deepEqual(a._, ['record', 'http://x/']);
  const o = resolveOptions(a);
  assert.equal(o.lang, 'en');
  assert.equal(o.debug, true);
  assert.equal(o.logLevel, 'debug');
  assert.equal(o.headless, true, '--script defaults to headless');
  assert.equal(resolveOptions(parseArgs(['record', 'u'])).headless, false, 'interactive recording is headed');
});

test('local validator mirrors 01 rules; secrets are redacted for logs', () => {
  assert.throws(() => localValidate({}), /steps/);
  assert.throws(() => localValidate({ steps: [{ action: 'click' }] }), /selector/);
  assert.throws(() => localValidate({ steps: [{ action: 'hover', selector: 'a' }] }), /unknown action/);
  localValidate({ steps: [{ action: 'open', url: '/' }] });
  assert.equal(redact({ action: 'fill', selector: '#p', text: 'x', secret: true }).text, '******');
});

test('CLI: help exits 0, missing URL exits 2', async () => {
  const h = await runNode(['src/cli.js', '--help', '--lang', 'en']);
  assert.equal(h.code, 0);
  assert.match(h.out, /Usage:/);
  const m = await runNode(['src/cli.js', 'record']);
  assert.equal(m.code, 2);
  assert.match(m.out, /請提供要錄製的網址/);
});
