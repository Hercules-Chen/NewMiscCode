// Playwright：實際開啟產生的 HTML 驗證分頁、子錨點、全部顯示、深色模式、390px 無水平捲動、無 console 錯誤。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildFile } from '../src/build.js';

const root = new URL('..', import.meta.url).pathname;
const exampleMd = root + 'examples/example.md';
const exampleHtml = root + 'examples/example.html';
let browser;

before(async () => {
  const r = await buildFile(exampleMd, { out: exampleHtml, embedImages: true });
  assert.deepEqual(r.problems, []);
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

async function open(file, { hash = '', width = 1280, colorScheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, colorScheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(file).href + hash);
  return { page, errors, ctx };
}
// hashchange 是非同步事件：先等目標分頁出現，再斷言「只有它」可見。
async function expectTab(page, id) {
  await page.waitForFunction(x => { const el = document.getElementById(x); return el && getComputedStyle(el).display !== 'none'; }, id, { timeout: 3000 }).catch(() => {});
  assert.deepEqual(await visibleTabs(page), [id]);
}
const visibleTabs = page => page.$$eval('section.tab', s => s.filter(x => getComputedStyle(x).display !== 'none').map(x => x.id));
const hScroll = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

test('click every tab: exactly that tab is visible and nav marks it', async () => {
  const { page, errors, ctx } = await open(exampleHtml);
  const ids = await page.$$eval('section.tab', s => s.map(x => x.id));
  assert.deepEqual(ids, ['overview', '快速開始', 'english']);
  assert.deepEqual(await visibleTabs(page), ['overview']); // default = first tab
  for (const id of ids) {
    await page.click(`#nav a[href="#${id}"]`);
    await expectTab(page, id);
    assert.equal(await page.$eval('#nav a.on', a => a.getAttribute('href')), '#' + id);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('sub-anchor deep link opens the containing tab and scrolls the heading into view', async () => {
  const { page, errors, ctx } = await open(exampleHtml, { hash: '#' + encodeURIComponent('安裝步驟'), width: 390 });
  await expectTab(page, '快速開始');
  const inView = h => page.$eval(`[id="${h}"]`, el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.top < innerHeight; });
  assert.equal(await inView('安裝步驟'), true);
  // 從另一分頁內的連結跳到其他分頁的子錨點
  await page.click('#nav a[href="#english"]');
  await page.click('section#english a[href="#安裝步驟"]');
  await expectTab(page, '快速開始');
  assert.equal(await inView('安裝步驟'), true);
  // 深連結到最後一個段落（需要捲動）
  await page.goto(pathToFileURL(exampleHtml).href + '#notes-2');
  await expectTab(page, 'english');
  assert.equal(await inView('notes-2'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('show-all mode and print media show every tab', async () => {
  const { page, errors, ctx } = await open(exampleHtml);
  await page.click('#nav a[href="#all"]');
  assert.deepEqual(await visibleTabs(page), ['overview', '快速開始', 'english']);
  assert.equal(await page.$eval('#nav a.on', a => a.getAttribute('href')), '#all');
  await page.click('#nav a[href="#overview"]');
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await visibleTabs(page), ['overview', '快速開始', 'english']);
  assert.equal(await page.$eval('#nav', n => getComputedStyle(n).display), 'none');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('dark mode via prefers-color-scheme and theme toggle; no horizontal scroll at 390px; screenshots', async () => {
  const desk = await open(exampleHtml);
  await desk.page.screenshot({ path: root + 'examples/example-desktop.png' });
  assert.equal(await desk.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(250, 250, 250)');
  await desk.page.click('#theme'); // auto -> light
  await desk.page.click('#theme'); // light -> dark
  assert.equal(await desk.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await desk.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 17, 23)');
  assert.deepEqual(desk.errors, []);
  await desk.ctx.close();

  const m = await open(exampleHtml, { width: 390, colorScheme: 'dark' });
  assert.equal(await m.page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 17, 23)');
  for (const h of ['#overview', '#快速開始', '#english', '#all']) {
    await m.page.evaluate(x => { location.hash = x; }, h);
    assert.equal(await hScroll(m.page), false, `horizontal scroll at 390px on ${h}`);
  }
  await m.page.goto(pathToFileURL(exampleHtml).href); // 乾淨的初始畫面再截圖
  await m.page.screenshot({ path: root + 'examples/example-mobile-dark.png' });
  assert.deepEqual(m.errors, []);
  await m.ctx.close();
});

test('generated README.html (dogfooding): every tab and anchor works, no errors, no h-scroll', async (t) => {
  const readme = root + 'README.html';
  if (!(await access(readme).then(() => true, () => false))) return t.skip('README.html not built yet');
  const { page, errors, ctx } = await open(readme, { width: 390 });
  const ids = await page.$$eval('section.tab', s => s.map(x => x.id));
  assert.ok(ids.length >= 8);
  for (const id of ids) {
    await page.click(`#nav a[href="#${id}"]`);
    await expectTab(page, id);
    assert.equal(await hScroll(page), false, `h-scroll on ${id}`);
  }
  const anchors = await page.$$eval('main h3[id]', hs => hs.map(h => [h.id, h.closest('section.tab').id]));
  for (const [id, tab] of anchors) {
    await page.evaluate(x => { location.hash = x; }, '#' + id);
    await expectTab(page, tab);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});
