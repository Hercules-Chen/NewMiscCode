// Inline suppression comments and config allowlists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { scanSamples, ROOT } from './helpers.js';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { run } from '../src/engine.js';

const FIX = join(ROOT, 'test/fixtures/allow');
const cfgWith = async (rules = {}) => {
  const { config } = await loadConfig({ searchDirs: [FIX] });
  for (const [id, v] of Object.entries(rules)) Object.assign(config.rules[id], v);
  return config;
};

test('csrules-disable-next-line / -line / -file suppress only the named rules', async () => {
  const r = await scanSamples();
  const sup = r.suppressed.map(f => `${f.file}:${f.line}:${f.ruleId}`).sort();
  assert.deepEqual(sup, [
    'SampleApp/Violations/LegacyInterop.cs:7:R3',
    'SampleApp/Violations/Suppressed.cs:12:R1',
    'SampleApp/Violations/Suppressed.cs:17:R5',
    'SampleApp/Violations/Suppressed.cs:29:R1',
  ]);
  // "-next-line R3" above a .Result does not hide R1 (reason text mentioning R1 is ignored)
  assert.ok(r.findings.some(f => f.file.endsWith('Suppressed.cs') && f.line === 23 && f.ruleId === 'R1'));
});

test('allowlist by path glob, attribute and class name (Startup + test project in samples)', async () => {
  const r = await scanSamples();
  const allowed = r.allowed.map(f => `${f.file}:${f.line}:${f.reason}`).sort();
  assert.deepEqual(allowed, [
    'SampleApp.Tests/OrderServiceTests.cs:12:path **/*.Tests/**',
    'SampleApp.Tests/OrderServiceTests.cs:14:path **/*.Tests/**',
    'SampleApp/Startup.cs:10:path **/Startup.cs',
  ]);
});

test('fixture: attribute [Fact], class *Tests and path **/*.UnitTests/** are allowed by default', async () => {
  const r = await run({ targets: [FIX], config: await cfgWith() });
  assert.deepEqual(r.findings.map(f => `${f.file}:${f.line}:${f.ruleId}`), ['src/Worker.cs:10:R1']);
  const reasons = r.allowed.map(f => f.reason).sort();
  assert.deepEqual(reasons, ['attribute [Fact]', 'class WorkerTests', 'path **/*.UnitTests/**']);
});

test('fixture: emptying the allowlist reports everything; Try* toggle', async () => {
  const r = await run({ targets: [FIX], config: await cfgWith({ R1: { allow: { paths: [], attributes: [], classes: [] } }, R3: { ignoreTryPattern: false } }) });
  const keys = r.findings.map(f => `${f.file}:${f.line}:${f.ruleId}`).sort();
  assert.deepEqual(keys, ['MyApp.UnitTests/PathAllowed.cs:5:R1', 'src/Worker.cs:10:R1', 'src/Worker.cs:12:R3', 'src/Worker.cs:19:R1', 'src/Worker.cs:8:R1']);
});

test('fixture: disabled rule and severity override', async () => {
  const r = await run({ targets: [FIX], config: await cfgWith({ R1: { enabled: false }, R3: { ignoreTryPattern: false, severity: 'note' } }) });
  assert.deepEqual(r.findings.map(f => `${f.ruleId}:${f.severity}`), ['R3:note']);
});

test('defaults are sane', () => {
  assert.equal(DEFAULT_CONFIG.rules.R1.severity, 'error');
  assert.ok(DEFAULT_CONFIG.rules.R1.allow.paths.includes('**/Startup.cs'));
});
