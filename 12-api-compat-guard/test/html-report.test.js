// Playwright：開啟 HTML 報告，檢查數字、語言切換、分頁、無 console 錯誤、390px 無水平捲動，並存截圖到 examples/。
// Playwright checks of the HTML reports; saves screenshots into examples/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
let pw = null;
for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch { /* next */ } }

test('HTML reports render, counts match, language toggles, no console errors', { skip: !pw && 'playwright not installed' }, async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'apiguard-html-'));
  const browser = await pw.chromium.launch();
  try {
    const code = await new Promise(res => spawn(process.execPath, [join(ROOT, 'scripts/demo.js'), '--out-dir', dir, '--data-dir', dir], { cwd: ROOT, stdio: 'ignore' }).on('close', res));
    assert.equal(code, 0);
    await mkdir(join(ROOT, 'examples'), { recursive: true });
    for (const [file, json] of [['diff-report.html', null], ['replay-report.html', 'replay-report.json']]) {
      const html = join(dir, file);
      const expected = json ? JSON.parse(await readFile(join(dir, json), 'utf8')).summary : JSON.parse((await readFile(html, 'utf8')).match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1]).summary;
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(pathToFileURL(html).href);
      for (const k of ['BREAKING', 'NON_BREAKING', 'INFO']) assert.equal(Number(await page.textContent(`#count-${k}`)), expected[k], `${file} ${k}`);
      assert.match(await page.textContent('#verdict'), /破壞性變更/);
      await page.click('#lang-toggle');
      assert.match(await page.textContent('#verdict'), /Breaking changes found/);
      assert.equal(await page.getAttribute('html', 'lang'), 'en');
      await page.click('button[data-tab=changes]');
      const rows = await page.$$eval('#findings tbody tr', r => r.length);
      assert.equal(rows, expected.BREAKING + expected.NON_BREAKING + expected.INFO);
      await page.click('button[data-filter=BREAKING]');
      assert.equal(await page.$$eval('#findings tbody tr', r => r.length), expected.BREAKING);
      if (file === 'replay-report.html') {
        await page.click('button[data-tab=exchanges]');
        assert.equal(await page.$$eval('#exchange-table tbody tr', r => r.length), 8);
        await page.screenshot({ path: join(ROOT, 'examples', 'replay-report-en.png') });
      } else {
        await page.click('#lang-toggle');
        await page.click('button[data-filter=ALL]');
        await page.screenshot({ path: join(ROOT, 'examples', 'diff-report-zh.png') });
      }
      await page.click('button[data-tab=raw]');
      assert.match(await page.textContent('#raw-json'), /"tool": "apiguard"/);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.click('button[data-tab=changes]');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `${file} horizontal scroll at 390px`);
      if (file === 'diff-report.html') await page.screenshot({ path: join(ROOT, 'examples', 'diff-report-mobile.png') });
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('README.html: deep links to sub-anchors open the right tab, no console errors, no h-scroll at 390px', { skip: !pw && 'playwright not installed' }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const url = pathToFileURL(join(ROOT, 'README.html')).href;
    for (const [hash, tab] of [['#usage-config', 'usage'], ['#verify-replay', 'verify'], ['#aspnet-export', 'aspnet'], ['#rule-RESPONSE_TYPE_CHANGED', 'rules'], ['#english', 'english']]) {
      await page.goto(url + hash);
      await page.waitForTimeout(30);
      assert.equal(await page.$eval('section.tab.active', s => s.id), tab, hash);
      assert.ok(await page.isVisible(hash), `${hash} visible`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `h-scroll ${hash}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
