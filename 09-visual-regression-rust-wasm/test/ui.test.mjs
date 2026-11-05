// ui.test.mjs - Playwright: browser UI (upload two PNGs, stats, views, language, ?debug=1)
// and the HTML report (views, language). Saves small screenshots into examples/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/paths.js';
import { startServer } from '../src/server.js';
import { loadPlaywright } from '../src/pw.js';
import { createLogger } from '../src/logger.js';
import { runSuite, approve } from '../src/run.js';
import { FIX, TEST_OUT } from './helpers.mjs';

const EX = join(ROOT, 'examples');
let srv, browser;

before(async () => {
  srv = await startServer({ port: 0 });
  browser = await (await loadPlaywright()).chromium.launch();
  await mkdir(EX, { recursive: true });
});
after(async () => { await browser?.close(); await srv?.close(); });

function watchErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return errs;
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test('browser UI: upload two PNGs, diff stats, views, language toggle, no console errors', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
  const errs = watchErrors(page);
  await page.goto(`${srv.url}/web/index.html`);
  await page.waitForSelector('body[data-ready="1"]');
  assert.equal(await page.textContent('h1'), '視覺回歸比對（Rust + WebAssembly）');
  await page.setInputFiles('#fileA', join(FIX, 'base.png'));
  await page.setInputFiles('#fileB', join(FIX, 'current.png'));
  await page.waitForFunction(() => document.getElementById('sDiff').textContent !== '');
  assert.equal(await page.textContent('#sDiff'), '3,360');
  assert.equal(await page.textContent('#sBoxes'), '2');
  assert.equal(await page.textContent('#sPct'), '5.25%');
  assert.equal(await page.textContent('#status'), '偵測到變更。');
  assert.equal(await page.locator('#viewer .vr-boxes rect').count(), 2);
  for (const m of ['side', 'onion', 'diff', 'slider']) {
    await page.click(`#viewer .vr-mode[data-mode="${m}"]`);
    assert.equal(await page.getAttribute('#viewer .vr-body', 'data-mode'), m);
  }
  await page.fill('#viewer input[data-role=wipe]', '30');
  // threshold / ignore re-compare
  await page.fill('#ignore', '200,120,40,30; 16,158,90,24');
  await page.click('#compareBtn');
  await page.waitForFunction(() => document.getElementById('sDiff').textContent === '0');
  assert.equal(await page.textContent('#status'), '兩張圖相同（在門檻值內）。');
  await page.fill('#ignore', '');
  await page.click('#compareBtn');
  await page.waitForFunction(() => document.getElementById('sDiff').textContent === '3,360');
  await page.screenshot({ path: join(EX, 'ui-diff.png') });
  await page.click('#langBtn');
  assert.equal(await page.textContent('h1'), 'Visual Regression Diff (Rust + WebAssembly)');
  assert.match(await page.textContent('#nameA'), /^Loaded: base\.png/);
  assert.equal(await page.textContent('#status'), 'Changes detected.');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await page.click('#langBtn');
  assert.equal(await page.getAttribute('html', 'lang'), 'zh-TW');
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await noHScroll(page), 'no horizontal scroll at 390px');
  assert.deepEqual(errs, []);
  await page.close();
});

test('browser UI ?debug=1 exposes window.VR and a debug log', async () => {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errs = watchErrors(page);
  await page.goto(`${srv.url}/web/index.html?debug=1&lang=en`);
  await page.waitForSelector('body[data-ready="1"]');
  await page.click('#sampleBtn');
  await page.waitForFunction(() => window.VR.state.result && window.VR.state.result.stats.diffPixels === 3360);
  assert.equal(await page.isVisible('#debugPanel'), true);
  assert.match(await page.textContent('#debugLog'), /"msg":"compare"/);
  const dbg = await page.evaluate(() => ({ debug: window.VR.debug, n: window.VR.logs.length, v: window.VR.core.version }));
  assert.equal(dbg.debug, true);
  assert.ok(dbg.n >= 3);
  assert.match(dbg.v, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(errs, []);
  await page.close();
});

test('HTML report: demo v1 -> v2 shows changed pages, views and language toggle', async () => {
  const out = join(TEST_OUT, 'ui-report');
  await rm(out, { recursive: true, force: true });
  const log = await createLogger({ dir: join(out, 'logs'), quiet: true });
  const configPath = join(ROOT, 'demo', 'vr.config.json');
  await runSuite({ configPath, site: join(ROOT, 'demo', 'v1'), outDir: out, log });
  await approve({ outDir: out, log });
  const r = await runSuite({ configPath, site: join(ROOT, 'demo', 'v2'), outDir: out, log });
  await log.close();
  assert.equal(r.exitCode, 1);
  await copyFile(join(out, 'diff', 'home.png'), join(EX, 'diff-home.png'));

  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
  const errs = watchErrors(page);
  await page.goto(pathToFileURL(r.reportPath).href);
  assert.equal(await page.textContent('#cChanged'), '2');
  assert.equal(await page.locator('section.page[data-status=changed]').count(), 2);
  assert.ok(Number(await page.textContent('#page-home .box-count')) >= 2);
  await page.click('#page-home .vr-mode[data-mode="side"]');
  assert.equal(await page.locator('#page-home .vr-side img').count(), 3);
  await page.click('#page-home .vr-mode[data-mode="onion"]');
  await page.fill('#page-home input[data-role=onion]', '80');
  await page.click('#page-home .vr-mode[data-mode="slider"]');
  assert.equal(await page.textContent('header h1'), '視覺回歸報告');
  await page.screenshot({ path: join(EX, 'report.png') });
  await page.click('#langBtn');
  assert.equal(await page.textContent('header h1'), 'Visual Regression Report');
  assert.match(await page.textContent('#page-home .badge'), /changed/);
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await noHScroll(page), 'report: no horizontal scroll at 390px');
  assert.deepEqual(errs, []);
  await page.close();
});
