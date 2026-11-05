// Playwright: open the HTML report, check counts, language toggle, grouping, no console errors,
// no horizontal scroll at 390px; save small screenshots into examples/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { scanSamples, ROOT } from './helpers.js';
import { toHtml } from '../src/reporters/html.js';

const require = createRequire(import.meta.url);
let pw = null;
try { pw = require('playwright'); } catch { /* global module path */ }
if (!pw) { try { pw = require(join(process.execPath, '../../lib/node_modules/playwright')); } catch { pw = null; } }

test('HTML report renders, counts match, language toggle works', { skip: !pw && 'playwright not available' }, async () => {
  const result = await scanSamples();
  const outDir = join(ROOT, 'output');
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, 'report-test.html');
  await writeFile(file, toHtml(result, { lang: 'zh-TW' }), 'utf8');
  // Also refresh the example report shipped in examples/
  await writeFile(join(ROOT, 'examples', 'report.html'), toHtml(result, { lang: 'zh-TW' }), 'utf8');

  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(file).href);
    assert.equal(await page.textContent('[data-testid=count-total]'), String(result.summary.total));
    assert.equal(await page.textContent('[data-testid=count-error]'), String(result.summary.error));
    assert.equal(await page.textContent('[data-testid=count-warning]'), String(result.summary.warning));
    assert.equal(await page.locator('[data-testid=finding]').count(), result.findings.length);
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
      assert.equal(await page.textContent(`[data-testid=rule-count-${id}]`), String(result.summary.byRule[id]));
      assert.equal(await page.locator(`[data-testid=finding][data-rule=${id}]`).count(), result.summary.byRule[id]);
    }
    assert.equal(await page.textContent('#title'), 'C# 程式規則檢查報告');
    assert.ok(await page.locator('mark.err').count() >= result.findings.length - 5, 'red marks on snippets');
    await page.screenshot({ path: join(ROOT, 'examples', 'report-zh-TW.png') });

    await page.click('[data-testid=lang-en]');
    assert.equal(await page.textContent('#title'), 'C# code rule report');
    assert.match(await page.locator('[data-testid=finding] .msg').first().textContent(), /^[\x20-\x7E]+$/);
    await page.click('[data-testid=group-file]');
    const groups = await page.locator('[data-testid=group] h2').allTextContents();
    assert.ok(groups.some(g => g.startsWith('SampleApp/Violations/R1_SyncOverAsync.cs (9)')), groups.join('|'));
    await page.locator('[data-testid=group] h2').nth(5).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(ROOT, 'examples', 'report-en-by-file.png') });

    await page.setViewportSize({ width: 390, height: 800 });
    await page.click('[data-testid=lang-zh]');
    await page.click('[data-testid=group-rule]');
    await page.evaluate(() => window.scrollTo(0, 0));
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.equal(hScroll, false, 'no horizontal scroll at 390px');
    await page.screenshot({ path: join(ROOT, 'examples', 'report-mobile-390.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('HTML report with zero findings', { skip: !pw && 'playwright not available' }, async () => {
  const empty = { tool: { name: 'csrules', version: '0' }, versions: { 'web-tree-sitter': 'x', 'tree-sitter-c-sharp': 'y' }, targets: ['x'], summary: { total: 0, error: 0, warning: 0, note: 0, byRule: {}, files: 1, suppressed: 0, allowed: 0 }, findings: [] };
  const file = join(ROOT, 'output', 'report-empty.html');
  await mkdir(join(ROOT, 'output'), { recursive: true });
  await writeFile(file, toHtml(empty, { lang: 'en' }), 'utf8');
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    assert.equal(await page.textContent('[data-testid=no-findings]'), 'No findings');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('README.html: deep links to sub-anchors open the right tab, no console errors', { skip: !pw && 'playwright not available' }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const base = pathToFileURL(join(ROOT, 'README.html')).href;
    for (const [hash, tab] of [['ci-azure', 'usage'], ['rule-R4', 'rules'], ['versions', 'dev'], ['verify-html', 'verify'], ['roslyn-when', 'roslyn'], ['logs', 'debug'], ['troubleshooting', 'limits'], ['english', 'english']]) {
      await page.goto(`${base}#${hash}`);
      assert.equal(await page.$eval('section.tab.active', s => s.id), tab, hash);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `no hscroll in ${tab}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
