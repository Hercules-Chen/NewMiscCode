// cli.test.mjs - `vr compare`, `vr run` (demo v1 baseline -> v2), `vr approve`, report contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/paths.js';
import { loadPlaywright } from '../src/pw.js';
import { FIX, TEST_OUT, vr, intersects } from './helpers.mjs';

test('vr compare: exit codes, diff file, JSON, ignore', async () => {
  const out = join(TEST_OUT, 'cli', 'diff.png');
  const r = await vr('compare', join(FIX, 'base.png'), join(FIX, 'current.png'), '--out', out, '--json', '--out-dir', join(TEST_OUT, 'cli'));
  assert.equal(r.code, 1, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.diffPixels, 3360);
  assert.equal(s.boxes.length, 2);
  assert.ok((await stat(out)).size > 1000);
  const r2 = await vr('compare', join(FIX, 'base.png'), join(FIX, 'current.png'), '--ignore', '200,120,40,30', '--ignore', '16,158,90,24', '--out-dir', join(TEST_OUT, 'cli'));
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  const r3 = await vr('compare', join(FIX, 'base.png'), '--out-dir', join(TEST_OUT, 'cli'));
  assert.equal(r3.code, 2);
  const r4 = await vr('compare', join(FIX, 'base.png'), join(FIX, 'current.png'), '--threshold', '7', '--out-dir', join(TEST_OUT, 'cli'));
  assert.equal(r4.code, 2);
  const r5 = await vr('compare', join(FIX, 'base.png'), join(FIX, 'base.png'), '--lang', 'en', '--debug', '--out-dir', join(TEST_OUT, 'cli'));
  assert.equal(r5.code, 0);
  assert.match(r5.stdout, /identical/);
  const logFile = r5.stderr.match(/log: (.+\.jsonl)/)[1];
  const lines = (await readFile(logFile, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.some(l => l.level === 'debug' && l.msg === 'start'));
  assert.ok(lines.every(l => l.ts && l.level && l.msg));
});

test('vr run: v1 baseline -> v1 passes -> v2 changes found at the changed elements', async () => {
  const out = join(TEST_OUT, 'run');
  await rm(out, { recursive: true, force: true });
  const common = ['--out-dir', out, '--config', join(ROOT, 'demo', 'vr.config.json')];
  let r = await vr('run', '--site', join(ROOT, 'demo', 'v1'), ...common);
  assert.equal(r.code, 1, 'first run: pages are new'); assert.match(r.stdout, /new\s+home/);
  r = await vr('approve', ...common);
  assert.equal(r.code, 0, r.stderr);
  r = await vr('run', '--site', join(ROOT, 'demo', 'v1'), ...common);
  assert.equal(r.code, 0, 'v1 vs v1 must pass (clock is ignored by selector): ' + r.stdout + r.stderr);
  r = await vr('run', '--site', join(ROOT, 'demo', 'v2'), ...common);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const rep = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'));
  assert.deepEqual(rep.results.map(x => x.status), ['changed', 'changed']);
  const html = await readFile(join(out, 'report.html'), 'utf8');
  assert.match(html, /data:image\/png;base64,/);
  assert.ok(!/src="(?!data:)[^"]+\.png"/.test(html), 'report must be self-contained');

  // Expected regions = bounding boxes of [data-vr-change] elements in the v2 pages.
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
    for (const res of rep.results) {
      await page.goto(pathToFileURL(join(ROOT, 'demo', 'v2', `${res.name}.html`.replace('home.html', 'index.html'))).href);
      const expected = await page.$$eval('[data-vr-change]', els => els.map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.vrChange, x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; }));
      assert.ok(expected.length >= 2);
      for (const e of expected) assert.ok(res.stats.boxes.some(b => intersects(b, e)), `${res.name}: no box for changed element ${e.id}`);
      for (const b of res.stats.boxes) assert.ok(expected.some(e => intersects(b, e, 4)), `${res.name}: unexpected box ${JSON.stringify(b)}`);
      assert.ok(res.ignore.some(i => i.selector === '#clock'), 'clock ignored');
    }
  } finally { await browser.close(); }
});
