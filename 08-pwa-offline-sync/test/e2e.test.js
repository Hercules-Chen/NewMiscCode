// End-to-end tests with Playwright (Chromium): SW, offline, outbox replay, idempotency, conflicts, update flow, i18n.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const VIEWPORT = { width: 390, height: 844 };
let app, base, dir, browser;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pwa08-e2e-'));
  app = await createApp({ dataDir: dir, logDir: join(dir, 'logs'), debug: true, logToConsole: false });
  base = await app.listen(0); // ephemeral port
  // channel 'chromium' = new headless mode, which supports Background Sync (the headless shell reports it as disabled).
  browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
  await mkdir(EXAMPLES, { recursive: true });
});
after(async () => {
  await browser?.close();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

/** New isolated context + page with console/page error collection. */
async function openApp(query = '', { bgSync = true } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'zh-TW' });
  if (bgSync) await ctx.grantPermissions(['background-sync'], { origin: base }); // automation default may deny it
  // Simulate a browser without the Background Sync API (Firefox/Safari) in the page.
  else await ctx.addInitScript(() => { delete ServiceWorkerRegistration.prototype.sync; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base + '/' + query);
  await page.evaluate(() => window.__pwa.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  return { ctx, page, errors };
}
const pending = (page) => page.$eval('#pending-count', (e) => Number(e.textContent));
const waitPending = (page, n, timeout = 15000) => page.waitForFunction((n) => document.querySelector('#pending-count').textContent === String(n), n, { timeout });
async function createRecord(page, title, extra = {}) {
  await page.fill('#f-title', title);
  if (extra.location) await page.fill('#f-location', extra.location);
  if (extra.status) await page.selectOption('#f-status', extra.status);
  if (extra.note) await page.fill('#f-note', extra.note);
  await page.click('#save-btn');
  await page.waitForSelector(`#record-list .record:has-text("${title}")`);
}
async function editRecord(page, oldTitle, newTitle) {
  await page.click(`#record-list .record:has-text("${oldTitle}") .edit-btn`);
  await page.waitForFunction((t) => document.querySelector('#f-title').value === t && !document.querySelector('#cancel-btn').hidden, oldTitle);
  await page.fill('#f-title', newTitle);
  await page.click('#save-btn');
  await page.waitForSelector(`#record-list .record:has-text("${newTitle}")`, { timeout: 5000 }).catch(async (e) => { throw new Error(e.message + " formError=" + await page.textContent("#form-error") + " title=" + await page.inputValue("#f-title")); });
}
const serverByTitle = (title) => app.store.list().filter((r) => r.title === title && !r.deleted);

test('service worker registers, controls the page and precaches the versioned shell', async () => {
  const { ctx, page, errors } = await openApp();
  const info = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('shell-'));
    const cached = (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname);
    return { keys, shell, cached, scope: (await navigator.serviceWorker.getRegistration()).scope, manifest: document.querySelector('link[rel=manifest]').href };
  });
  assert.equal(info.shell, 'shell-' + app.buildId);
  for (const p of ['/', '/index.html', '/js/app.js', '/js/outbox-core.js', '/css/app.css', '/manifest.webmanifest', '/icons/icon-192.png']) assert.ok(info.cached.includes(p), 'precached ' + p);
  assert.equal(info.scope, base + '/');
  await page.waitForFunction((id) => document.querySelector('#build-id').textContent === id, app.buildId);
  const m = await (await page.request.get(info.manifest)).json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.find((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.equal(await page.getAttribute('html', 'lang'), 'zh-TW');
  // Chrome's own installability check (same as DevTools > Application > Manifest)
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  // 'in-incognito' only appears because automation contexts are incognito; anything else is a real problem.
  const instErrors = inst.installabilityErrors.filter((e) => e.errorId !== 'in-incognito');
  assert.deepEqual(instErrors, [], JSON.stringify(inst.installabilityErrors));
  const am = await cdp.send('Page.getAppManifest');
  assert.deepEqual(am.errors, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('offline: reload from cache, queue writes, then drain exactly once when online', async () => {
  const { ctx, page, errors } = await openApp();
  await createRecord(page, 'E2E 線上建立', { location: 'A 棟 1F' });
  await waitPending(page, 0);
  assert.equal(serverByTitle('E2E 線上建立').length, 1);

  await ctx.setOffline(true);
  await page.waitForSelector('#net-status[data-state="offline"]');
  await page.reload();                                   // must be served by the SW from cache
  await page.evaluate(() => window.__pwa.ready);
  assert.equal(await page.textContent('h1'), '現場巡檢紀錄');
  assert.ok(await page.isVisible('#record-list .record:has-text("E2E 線上建立")'), 'IndexedDB data visible offline');

  await createRecord(page, 'E2E 離線一', { status: 'issue', note: '漏水' });
  assert.equal(await pending(page), 1);
  await createRecord(page, 'E2E 離線二');
  assert.equal(await pending(page), 2);
  await editRecord(page, 'E2E 離線一', 'E2E 離線一（已編輯）');   // edit of a not-yet-synced record
  assert.equal(await pending(page), 3);
  await editRecord(page, 'E2E 線上建立', 'E2E 線上建立（離線編輯）'); // edit of a synced record
  assert.equal(await pending(page), 4);
  const tags = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return 'sync' in r ? r.sync.getTags() : ['unsupported']; });
  assert.ok(tags.includes('outbox-sync'), 'Background Sync registered: ' + tags);
  assert.equal(serverByTitle('E2E 離線二').length, 0, 'nothing reached the server while offline');
  // A forced replay inside the SW while offline must fail with a network error and keep the queue intact.
  const forced = await page.evaluate(() => window.__pwa.replay('forced-offline'));
  assert.ok(forced.networkError, 'SW replay sees the network as offline');
  assert.equal(forced.remaining, 4);
  assert.equal(serverByTitle('E2E 離線二').length, 0);
  await page.locator('#record-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(EXAMPLES, 'offline-pending.png') });

  await ctx.setOffline(false);
  // Fire extra concurrent replays (page + SW) on top of the automatic online sync: idempotency + locks must prevent duplicates.
  await page.evaluate(() => Promise.all([window.__pwa.core.replay({ source: 'test-a' }), window.__pwa.replay('test-b'), window.__pwa.sync('test-c')]));
  await waitPending(page, 0);
  assert.equal(serverByTitle('E2E 離線一（已編輯）').length, 1);
  assert.equal(serverByTitle('E2E 離線一').length, 0);
  assert.equal(serverByTitle('E2E 離線二').length, 1);
  assert.equal(serverByTitle('E2E 線上建立（離線編輯）').length, 1);
  assert.equal(serverByTitle('E2E 線上建立（離線編輯）')[0].version, 2);
  assert.equal(serverByTitle('E2E 離線一（已編輯）')[0].version, 2, 'create + chained edit => v2');
  assert.equal(serverByTitle('E2E 離線一（已編輯）')[0].status, 'issue');
  const local = await page.evaluate(() => window.__pwa.records());
  assert.ok(local.every((r) => !r.pending));
  const log = await page.evaluate(() => window.__pwa.log());
  assert.ok(log.some((e) => e.msg === 'acked'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('lost response: server applied the write but the client saw an error -> retry with same key, still one copy', async () => {
  const { ctx, page, errors } = await openApp('?nofallback=1');
  let dropped = 0;
  let seenKey = null;
  await ctx.route('**/api/records', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && dropped === 0) {
      dropped++;
      seenKey = req.headers()['idempotency-key'];
      await route.fetch();                      // the server really processes it ...
      return route.abort('connectionreset');    // ... but the response never arrives
    }
    return route.fallback();
  });
  await createRecord(page, 'E2E 回應遺失');     // online: Background Sync fires right away in the SW
  await page.waitForFunction(() => window.__pwa.log().then((l) => l.some((e) => e.msg === 'network-error')), null, { polling: 200, timeout: 15000 });
  assert.equal(dropped, 1);
  assert.equal(serverByTitle('E2E 回應遺失').length, 1, 'server applied the first attempt');
  // The item stays queued after the network error; it is retried (by us or a Background Sync retry, whichever wins the lock).
  await page.evaluate(() => window.__pwa.replay('retry'));
  await waitPending(page, 0);
  assert.equal(serverByTitle('E2E 回應遺失').length, 1, 'retry did not duplicate');
  const log = await page.evaluate(() => window.__pwa.log());
  const ack = log.find((e) => e.msg === 'acked' && e.data.key === seenKey);
  assert.ok(ack && ack.data.replayed === true, 'server answered from the idempotency store');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Background Sync alone drains the queue (page fallbacks disabled)', async () => {
  const { ctx, page, errors } = await openApp('?nofallback=1');
  await ctx.setOffline(true);
  await page.waitForSelector('#net-status[data-state="offline"]');
  await createRecord(page, 'E2E 背景同步');
  assert.equal(await pending(page), 1);
  await ctx.setOffline(false);                 // browser fires the SW "sync" event on reconnect
  await waitPending(page, 0);
  assert.equal(serverByTitle('E2E 背景同步').length, 1);
  const log = await page.evaluate(() => window.__pwa.log());
  assert.ok(log.some((e) => e.source === 'sw-bgsync' && e.msg === 'acked'), 'acked by the SW sync handler');
  assert.ok(!log.some((e) => /online-event|timer/.test(e.source)));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('fallback without Background Sync: online event replays the queue', async () => {
  const { ctx, page, errors } = await openApp('', { bgSync: false });
  await ctx.setOffline(true);
  await page.waitForSelector('#net-status[data-state="offline"]');
  await createRecord(page, 'E2E 備援同步');
  assert.equal(await pending(page), 1);
  assert.equal(await page.evaluate(async () => 'sync' in (await navigator.serviceWorker.ready)), false);
  assert.equal(await page.evaluate(() => window.__pwa.state.bgSync), false);
  await ctx.setOffline(false);
  await waitPending(page, 0);
  assert.equal(serverByTitle('E2E 備援同步').length, 1);
  const log = await page.evaluate(() => window.__pwa.log());
  assert.ok(log.some((e) => /online-event/.test(e.source) && e.msg === 'acked'), 'acked via online-event fallback');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('conflict between two devices: keep mine / take theirs', async () => {
  const A = await openApp();
  const B = await openApp();
  await createRecord(A.page, 'E2E 衝突項目');
  await waitPending(A.page, 0);
  await B.page.evaluate(() => window.__pwa.sync('test'));
  await B.page.waitForSelector('#record-list .record:has-text("E2E 衝突項目")');

  // Round 1: A edits offline, B edits online first -> A gets a conflict and keeps its own version.
  await A.ctx.setOffline(true);
  await editRecord(A.page, 'E2E 衝突項目', 'E2E 衝突 A 版');
  await editRecord(B.page, 'E2E 衝突項目', 'E2E 衝突 B 版');
  await waitPending(B.page, 0);
  assert.equal(serverByTitle('E2E 衝突 B 版')[0].version, 2);
  await A.ctx.setOffline(false);
  await A.page.waitForSelector('#conflict-section:not([hidden]) .conflict');
  assert.match(await A.page.textContent('#conflict-list'), /E2E 衝突 A 版[\s\S]*E2E 衝突 B 版/);
  await A.page.evaluate(() => window.scrollTo(0, 0));
  await A.page.screenshot({ path: join(EXAMPLES, 'conflict.png') });
  await A.page.click('.conflict .keep-mine');
  await waitPending(A.page, 0);
  await A.page.waitForSelector('#conflict-section', { state: 'hidden' });
  const afterMine = app.store.list().filter((r) => r.title.startsWith('E2E 衝突'));
  assert.equal(afterMine.length, 1);
  assert.equal(afterMine[0].title, 'E2E 衝突 A 版');
  assert.equal(afterMine[0].version, 3);

  // Round 2: B (still at v2) edits offline, A edits online -> B takes theirs.
  await B.ctx.setOffline(true);
  await editRecord(B.page, 'E2E 衝突 B 版', 'E2E 衝突 B 二版');
  await editRecord(A.page, 'E2E 衝突 A 版', 'E2E 衝突 A 二版');
  await waitPending(A.page, 0);
  await B.ctx.setOffline(false);
  await B.page.waitForSelector('#conflict-section:not([hidden]) .conflict');
  await B.page.click('.conflict .take-theirs');
  await B.page.waitForSelector('#record-list .record:has-text("E2E 衝突 A 二版")');
  assert.equal(await pending(B.page), 0);
  const final = app.store.list().filter((r) => r.title.startsWith('E2E 衝突'));
  assert.equal(final.length, 1);
  assert.equal(final[0].title, 'E2E 衝突 A 二版');
  assert.equal(final[0].version, 4);
  assert.equal(app.stats.conflicts >= 2, true);
  assert.deepEqual(A.errors, []);
  assert.deepEqual(B.errors, []);
  await A.ctx.close(); await B.ctx.close();
});

test('photo is resized client-side and synced; delete syncs as a tombstone', async () => {
  const { ctx, page, errors } = await openApp();
  page.on('dialog', (d) => d.accept());
  await page.fill('#f-title', 'E2E 照片紀錄');
  await page.setInputFiles('#f-photo', join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons', 'icon-512.png'));
  await page.waitForSelector('#photo-preview:not([hidden]) img');
  await page.click('#save-btn');
  await page.waitForSelector('#record-list .record:has-text("E2E 照片紀錄") img');
  await waitPending(page, 0);
  const [rec] = serverByTitle('E2E 照片紀錄');
  assert.match(rec.photo, /^data:image\/jpeg;base64,/);
  await page.click('#record-list .record:has-text("E2E 照片紀錄") .delete-btn');
  await page.waitForSelector('#record-list .record:has-text("E2E 照片紀錄")', { state: 'detached', timeout: 5000 }).catch(async (e) => {
    throw new Error(e.message + JSON.stringify(await page.evaluate(async () => ({ log: (await window.__pwa.log()).slice(-6), ob: await window.__pwa.outbox() }))) + errors.join('\n'));
  });
  await waitPending(page, 0);
  const row = app.store.get(rec.id);
  assert.equal(row.deleted, true);
  assert.equal(row.version, 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('language toggle, theme toggle, no horizontal scroll at 390px', async () => {
  const { ctx, page, errors } = await openApp('?debug=1');
  assert.equal(await page.textContent('h1'), '現場巡檢紀錄');
  assert.equal(await page.isVisible('#debug-flag'), true);
  await page.screenshot({ path: join(EXAMPLES, 'main-zh-TW.png') });
  await page.click('#lang-btn');
  assert.equal(await page.textContent('h1'), 'Field Inspection Notes');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.equal(await page.textContent('#save-btn'), 'Save');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'no h-scroll (en)');
  await page.reload();
  await page.evaluate(() => window.__pwa.ready);
  assert.equal(await page.textContent('h1'), 'Field Inspection Notes', 'language persisted');
  await page.click('#lang-btn');
  assert.equal(await page.textContent('#net-status .txt'), '線上');
  await page.click('#theme-btn');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  assert.equal(await page.textContent('#theme-btn'), '淺色');
  await page.click('#theme-btn');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(hscroll, false);
  assert.equal(typeof (await page.evaluate(() => typeof window.__pwa.counts)), 'string');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('SW update flow: new build -> banner -> reload activates it and removes old cache', async () => {
  const { ctx, page, errors } = await openApp();
  const oldId = app.buildId;
  await createRecord(page, 'E2E 更新前資料');
  await waitPending(page, 0);
  app.setBuildId('e2e-v2');                                  // simulate a deploy
  await page.evaluate(() => window.__pwa.checkUpdate());
  await page.waitForSelector('#update-banner:not([hidden])', { timeout: 15000 });
  assert.match(await page.textContent('#update-banner'), /新版本可用，重新載入/);
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('#reload-btn')]);
  await page.evaluate(() => window.__pwa.ready);
  await page.waitForFunction(() => document.querySelector('#build-id').textContent === 'e2e-v2', null, { timeout: 15000 });
  const keys = await page.evaluate(() => caches.keys());
  assert.ok(keys.includes('shell-e2e-v2'));
  assert.ok(!keys.includes('shell-' + oldId), 'old shell cache removed on activate');
  assert.equal(await page.isVisible('#update-banner'), false);
  assert.ok(await page.isVisible('#record-list .record:has-text("E2E 更新前資料")'));
  assert.deepEqual(errors, []);
  await ctx.close();
});
