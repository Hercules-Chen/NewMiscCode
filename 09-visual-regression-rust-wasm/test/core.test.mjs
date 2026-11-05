// core.test.mjs - wasm core in Node: correctness + byte-identical results vs the native Rust CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadCore } from '../src/core.js';
import { nativeBinary } from '../src/paths.js';
import { optionString, parseRect } from '../web/vrcore.js';
import { FIX, TEST_OUT, run } from './helpers.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

test('wasm loads and reports version', async () => {
  const core = await loadCore();
  assert.match(core.version, /^\d+\.\d+\.\d+$/);
});

test('identical images -> 0 diff, no boxes', async () => {
  const core = await loadCore();
  const a = await readFile(join(FIX, 'base.png'));
  const { stats, diffPng } = await core.compare(a, a, {});
  assert.equal(stats.diffPixels, 0);
  assert.equal(stats.boxes.length, 0);
  assert.equal(stats.percent, 0);
  assert.ok(diffPng.length > 100);
});

test('fixture changes -> two boxes at the painted rectangles', async () => {
  const core = await loadCore();
  const [a, b] = await Promise.all([readFile(join(FIX, 'base.png')), readFile(join(FIX, 'current.png'))]);
  const { stats } = await core.compare(a, b, { threshold: 0.1 });
  assert.equal(stats.diffPixels, 3360);
  assert.deepEqual(stats.boxes.map(({ x, y, w, h }) => ({ x, y, w, h })), [
    { x: 200, y: 120, w: 40, h: 30 },
    { x: 16, y: 158, w: 90, h: 24 },
  ]);
  const ig = await core.compare(a, b, { ignore: [parseRect('200,120,40,30'), [10, 150, 100, 40]] });
  assert.equal(ig.stats.diffPixels, 0);
  assert.equal(ig.stats.ignoredPixels, 1200 + 4000);
});

test('errors are reported, not thrown as traps', async () => {
  const core = await loadCore();
  await assert.rejects(core.compare(new Uint8Array([1, 2, 3]), new Uint8Array([4]), {}), /PNG decode/);
  await assert.rejects(core.compare(new Uint8Array(1), new Uint8Array(1), 'threshold=5'), /threshold/);
  assert.equal(optionString({ threshold: 0.2, includeAA: true, ignore: [{ x: 1, y: 2, w: 3, h: 4 }] }), 'threshold=0.2;aa=1;ignore=1,2,3,4');
  // core still usable after errors
  const a = await readFile(join(FIX, 'base.png'));
  assert.equal((await core.compare(a, a, {})).stats.diffPixels, 0);
});

test('wasm results equal native CLI results (JSON + diff PNG bytes)', async (t) => {
  const native = nativeBinary();
  if (!native) { t.skip('native binary not built: npm run build:native'); return; }
  await mkdir(TEST_OUT, { recursive: true });
  const core = await loadCore();
  const cases = [
    { a: 'base.png', b: 'current.png', flags: [], opts: {} },
    { a: 'base.png', b: 'base.png', flags: [], opts: {} },
    { a: 'current.png', b: 'base.png', flags: ['--threshold', '0.05', '--aa', '--gap', '0'], opts: { threshold: 0.05, includeAA: true, gap: 0 } },
    { a: 'base.png', b: 'current.png', flags: ['--ignore', '200,120,20,30'], opts: { ignore: [parseRect('200,120,20,30')] } },
  ];
  for (const c of cases) {
    const out = join(TEST_OUT, 'native-diff.png');
    const r = await run(native, ['compare', join(FIX, c.a), join(FIX, c.b), '--out', out, ...c.flags]);
    assert.ok(r.code === 0 || r.code === 1, r.stderr);
    const nativeStats = JSON.parse(r.stdout);
    const [ba, bb] = await Promise.all([readFile(join(FIX, c.a)), readFile(join(FIX, c.b))]);
    const w = await core.compare(ba, bb, c.opts);
    assert.deepEqual(w.stats, nativeStats, `stats differ for ${c.a} vs ${c.b} ${c.flags.join(' ')}`);
    assert.equal(sha(w.diffPng), sha(await readFile(out)), 'diff PNG bytes differ');
  }
});
