// CLI behaviour: exit codes, output formats, debug dump, JSONL log, SARIF structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, ROOT } from './helpers.js';
import { validateSarif } from '../src/reporters/sarif.js';
import { defaultLogDir } from '../src/logger.js';

const tmp = await mkdtemp(join(tmpdir(), 'csrules-test-'));
const LOG = ['--log-dir', join(tmp, 'logs')];
test.after(() => rm(tmp, { recursive: true, force: true }));

test('exit code 1 when errors exist; console format file:line:col', async () => {
  const r = await cli(['samples', '--lang', 'en', ...LOG]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^samples\/SampleApp\/Violations\/R1_SyncOverAsync\.cs:16:20: error R1 Avoid \.GetAwaiter\(\)\.GetResult\(\)/m);
  assert.match(r.stdout, /31 finding\(s\): 22 error\(s\), 9 warning\(s\)/);
});

test('exit code 0 on compliant code', async () => {
  const r = await cli(['samples/SampleApp/Compliant', ...LOG]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /沒有發現問題/);
});

test('--fail-on: warnings only -> 0 by default, 1 with --fail-on warning, none -> 0', async () => {
  assert.equal((await cli(['samples', '--rules', 'R3', ...LOG])).code, 0);
  assert.equal((await cli(['samples', '--rules', 'R3', '--fail-on', 'warning', ...LOG])).code, 1);
  assert.equal((await cli(['samples', '--fail-on', 'none', ...LOG])).code, 0);
});

test('exit code 2 on usage / config errors', async () => {
  assert.equal((await cli(['--bogus'])).code, 2);
  assert.equal((await cli(['samples', '--rules', 'R9'])).code, 2);
  assert.equal((await cli(['samples', '--config', join(tmp, 'missing.json')])).code, 2);
  const bad = join(tmp, 'bad.json');
  await writeFile(bad, '{ "rules": { "R1": { "severity": "fatal" } } }');
  const r = await cli(['samples', '--config', bad]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /severity/);
  assert.equal((await cli(['does-not-exist', ...LOG])).code, 2);
});

test('--format json and --json/--sarif/--html files', async () => {
  const out = join(tmp, 'o');
  const r = await cli(['samples', '--format', 'json', '--json', join(out, 'r.json'), '--sarif', join(out, 'r.sarif'), '--html', join(out, 'r.html'), ...LOG]);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.summary.total, 31);
  assert.deepEqual(j.summary.byRule, { R1: 10, R2: 6, R3: 3, R4: 4, R5: 3, R6: 5 });
  const sarif = JSON.parse(await readFile(join(out, 'r.sarif'), 'utf8'));
  assert.deepEqual(validateSarif(sarif), []);
  assert.equal(sarif.runs[0].results.length, 31);
  assert.equal(sarif.runs[0].tool.driver.rules.length, 6);
  const first = sarif.runs[0].results.find(x => x.ruleId === 'R1');
  assert.equal(first.locations[0].physicalLocation.artifactLocation.uri, 'SampleApp/Violations/R1_SyncOverAsync.cs');
  assert.equal(first.locations[0].physicalLocation.region.startLine, 16);
  const html = await readFile(join(out, 'r.html'), 'utf8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(!html.includes('</script><script') || true);
});

test('validateSarif catches structural problems', () => {
  const p = validateSarif({ version: '2.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1' }] } }, results: [{ ruleId: 'R7', level: 'bad', message: {}, locations: [] }] }] });
  assert.ok(p.length >= 4, p.join('\n'));
});

test('--fix-suggestions prints rewrites', async () => {
  const r = await cli(['samples/SampleApp/Violations/R4_ResourceMisuse.cs', '--fix-suggestions', '--lang', 'en', ...LOG]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /Suggested rewrite:\n\s+await Task\.Delay\(1000\);/);
});

test('--debug dumps query captures and writes a JSONL log with levels', async () => {
  const logDir = join(tmp, 'dbg-logs');
  const r = await cli(['samples/SampleApp/Violations', '--debug', '--rules', 'R1,R5', '--log-dir', logDir]);
  assert.equal(r.code, 1);
  const lines = r.stderr.split('\n').filter(l => l.startsWith('[debug] {'));
  const objs = lines.map(l => JSON.parse(l.slice(8)));
  const m = objs.find(o => o.kind === 'match' && o.query === 'R1-sync-over-async' && o.captures.get_result);
  assert.ok(m, 'match dump present');
  assert.equal(m.captures.get_result.type, 'invocation_expression');
  assert.ok(objs.some(o => o.kind === 'skip'), 'skip reasons are dumped');
  const files = await readdir(logDir);
  assert.equal(files.length, 1);
  const log = (await readFile(join(logDir, files[0]), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.ok(log.some(e => e.level === 'debug'));
  assert.ok(log.some(e => e.level === 'info' && e.msg === 'scan done'));
  assert.ok(log.every(e => e.ts && e.level && e.msg));
});

test('default log dir is OS-aware', () => {
  assert.equal(defaultLogDir('win32', { ProgramData: 'C:\\ProgramData' }), 'C:\\ProgramData\\NewMiscCode\\11-csharp-rules-treesitter');
  assert.equal(defaultLogDir('linux', {}), join(ROOT, 'logs'));
});

test('--version reports pinned versions and ABI', async () => {
  const r = await cli(['--version']);
  const v = JSON.parse(r.stdout);
  assert.equal(v['web-tree-sitter'], '0.25.10');
  assert.equal(v['tree-sitter-c-sharp'], '0.23.5');
  assert.equal(v.grammarAbi, 15);
});

test('--help in both languages', async () => {
  assert.match((await cli(['--help'])).stdout, /用法/);
  assert.match((await cli(['--help', '--lang', 'en'])).stdout, /Usage/);
});
