// Per-rule tests: every "// expect: Rn" marker in samples/ must be reported at exactly that line,
// and nothing else may be reported (compliant code => zero findings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSamples, expectedMarkers, key } from './helpers.js';
import { loadLanguage, versions } from '../src/engine.js';
import { readFile } from 'node:fs/promises';

const ruleIds = ['R1', 'R2', 'R3', 'R4', 'R5'];

test('grammar wasm loads with a compatible ABI', async () => {
  const { lang } = await loadLanguage();
  assert.ok(lang.abiVersion >= 13 && lang.abiVersion <= 15, `ABI ${lang.abiVersion}`);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const v = versions();
  assert.equal(pkg.dependencies['web-tree-sitter'], v['web-tree-sitter'], 'web-tree-sitter pinned exactly');
  assert.equal(pkg.dependencies['tree-sitter-c-sharp'], v['tree-sitter-c-sharp'], 'grammar pinned exactly');
});

for (const id of ruleIds) {
  test(`${id}: findings at exactly the marked lines`, async () => {
    const r = await scanSamples();
    const actual = r.findings.filter(f => f.ruleId === id).map(key).sort();
    const expected = (await expectedMarkers()).filter(k => k.endsWith(':' + id));
    assert.ok(expected.length >= 3, `${id} has at least 3 sample violations`);
    assert.deepEqual(actual, expected);
  });
}

test('exact spot checks (line + column)', async () => {
  const r = await scanSamples();
  const at = (file, line, col, rule) => r.findings.find(f => f.file === file && f.line === line && f.column === col && f.ruleId === rule);
  assert.ok(at('SampleApp/Violations/R1_SyncOverAsync.cs', 16, 20, 'R1'), 'GetAwaiter().GetResult()');
  assert.ok(at('SampleApp/Violations/R1_SyncOverAsync.cs', 37, 38, 'R1'), 't1.Result');
  assert.ok(at('SampleApp/Violations/R1_SyncOverAsync.cs', 37, 50, 'R1'), 't2.Result');
  assert.ok(at('SampleApp/Violations/R2_PreferAsync.cs', 12, 27, 'R2'), 'async void FireAndForget');
  assert.ok(at('SampleApp/Violations/R4_ResourceMisuse.cs', 22, 33, 'R4'), 'HttpClient client = new()');
  assert.ok(at('SampleApp/Violations/R5_SwallowedExceptions.cs', 38, 13, 'R5'), 'bare catch');
});

test('R6: encoding problems at exact files/lines, compliant scripts pass', async () => {
  const r = await scanSamples();
  const actual = r.findings.filter(f => f.ruleId === 'R6').map(f => `${f.file}:${f.line}:${f.message.en.split(' ')[0]}`).sort();
  assert.deepEqual(actual, [
    'encoding-bad/Big5Legacy.cs:1:.cs',
    'encoding-bad/bom-readme.md:1:.md',
    'encoding-bad/legacy.bat:2:.bat',
    'encoding-bad/no-bom.ps1:1:.ps1',
    'encoding-bad/notes-big5.md:1:.md',
  ]);
  assert.match(r.findings.find(f => f.file.endsWith('legacy.bat')).message.en, /pure ASCII/);
  assert.match(r.findings.find(f => f.file.endsWith('no-bom.ps1')).message.en, /BOM/);
});

test('compliant code, Startup and test project produce zero findings', async () => {
  const r = await scanSamples();
  const bad = r.findings.filter(f => /Compliant\/|Startup\.cs|SampleApp\.Tests\/|scripts\/|README\.md/.test(f.file));
  assert.deepEqual(bad.map(key), []);
});

test('suggestions are produced for every AST finding', async () => {
  const r = await scanSamples();
  for (const f of r.findings) assert.ok(f.suggestion, `suggestion for ${key(f)}`);
  const s = r.findings.find(f => f.file.endsWith('R3_OutParams.cs') && f.line === 8).suggestion;
  assert.equal(s, '(bool Result, int Value, string Error) Parse(string s)');
  const s2 = r.findings.find(f => f.file.endsWith('R4_ResourceMisuse.cs') && f.line === 28).suggestion;
  assert.equal(s2, 'await Task.Delay(1000);');
});

test('every finding has both zh-TW and en messages', async () => {
  const r = await scanSamples();
  for (const f of r.findings) {
    assert.ok(f.message['zh-TW'] && f.message.en, key(f));
    assert.match(f.message['zh-TW'], /[一-鿿]/);
  }
});
