// End-to-end: real server process + two isolated Chromium contexts (= two users, separate IndexedDB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOM = `e2e${Date.now().toString(36)}`;

let port, dataDir, srv, browser, ctxA, ctxB, A, B;
const consoleErrors = [];
let allowConnErrors = false; // while the server is down / browser offline, WebSocket failures are expected

async function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/server/index.js', '--port', String(port), '--data-dir', dataDir, '--debug'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = d => {
      out += d;
      if (out.includes('server.listening')) { child.stdout.off('data', onData); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => reject(new Error(`server exited early (${code}): ${out}`)));
  });
}

async function stopServer(signal) {
  const exited = new Promise(r => srv.once('exit', r));
  srv.kill(signal);
  await exited;
}

async function openUser(ctx, name, color) {
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (allowConnErrors && /WebSocket|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|Failed to load resource/.test(text)) return;
    consoleErrors.push(`${name}: ${text}`);
  });
  page.on('pageerror', e => consoleErrors.push(`${name} pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/?room=${ROOM}&name=${encodeURIComponent(name)}&color=${encodeURIComponent(color)}`);
  await page.waitForFunction(() => window.__collab?.status() === 'connected');
  return page;
}

const text = p => p.evaluate(() => window.__collab.text());
const taValue = p => p.$eval('#notes', el => el.value);
async function converge(timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const [a, b, ta, tb, ka, kb] = await Promise.all([text(A), text(B), taValue(A), taValue(B), A.evaluate(() => JSON.stringify(__collab.tasks())), B.evaluate(() => JSON.stringify(__collab.tasks()))]);
    if (a === b && a === ta && b === tb && ka === kb) return a;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`did not converge:\nA=${JSON.stringify(await text(A))}\nB=${JSON.stringify(await text(B))}`);
}
const caretTo = (p, where) => p.evaluate(w => {
  const ta = document.getElementById('notes');
  ta.focus();
  const i = w === 'end' ? ta.value.length : w;
  ta.setSelectionRange(i, i);
}, where);

before(async () => {
  port = await freePort();
  dataDir = await mkdtemp(join(tmpdir(), 'collab-e2e-'));
  srv = await startServer();
  browser = await chromium.launch();
  ctxA = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  ctxB = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  A = await openUser(ctxA, 'Alice', '#d9480f');
  B = await openUser(ctxB, 'Bob', '#1971c2');
});

after(async () => {
  await browser?.close();
  if (srv && srv.exitCode === null) await stopServer('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
});

test('presence: each user sees the other (name list + remote caret)', async () => {
  await A.waitForSelector('#presence li:has-text("Bob")');
  await B.waitForSelector('#presence li:has-text("Alice")');
  await caretTo(B, 0);
  await B.keyboard.type('x');
  await A.waitForSelector('.remote-caret[data-user="Bob"]');
  await B.keyboard.press('Backspace');
  await converge();
});

test('concurrent typing from two users converges to identical content', async () => {
  await caretTo(A, 'end');
  await caretTo(B, 0);
  await Promise.all([
    A.keyboard.type('Alice types at the end. ', { delay: 15 }),
    B.keyboard.type('Bob types at the start. ', { delay: 15 })
  ]);
  await Promise.all([
    (async () => { await A.fill('#taskInput', 'Alice 的任務'); await A.press('#taskInput', 'Enter'); })(),
    (async () => { await B.fill('#taskInput', 'Bob 的任務'); await B.press('#taskInput', 'Enter'); })()
  ]);
  const final = await converge();
  assert.ok(final.includes('Alice types at the end. '), final);
  assert.ok(final.includes('Bob types at the start. '), final);
  await B.waitForFunction(() => document.querySelectorAll('#taskList .task').length === 2);
  await B.click('#taskList .task:has-text("Alice") input[type=checkbox]');
  await A.waitForSelector('#taskList .task.done:has-text("Alice")');
});

test('Chinese text: insertText and real IME composition (with a concurrent remote edit)', async () => {
  await caretTo(A, 'end');
  await A.keyboard.insertText('繁體中文測試，標點符號。');
  await converge();
  // IME composition via Chrome DevTools Protocol (same events a Windows Bopomofo IME produces)
  const cdp = await ctxA.newCDPSession(A);
  await caretTo(A, 'end');
  await cdp.send('Input.imeSetComposition', { text: 'ㄓㄨㄥ', selectionStart: 3, selectionEnd: 3 });
  await A.waitForFunction(() => window.__collab.binding.composing === true);
  // while Alice is composing, Bob edits the beginning
  await caretTo(B, 0);
  await B.keyboard.insertText('【Bob 插入】');
  await A.waitForFunction(() => window.__collab.text().startsWith('【Bob 插入】'));
  // Alice's textarea must not be disturbed mid-composition
  const mid = await taValue(A);
  assert.ok(mid.endsWith('ㄓㄨㄥ'), `composition text kept: ${mid}`);
  assert.ok(!(await text(A)).includes('ㄓ'), 'uncommitted composition is not written to the CRDT');
  await cdp.send('Input.insertText', { text: '中' });
  await A.waitForFunction(() => window.__collab.binding.composing === false);
  const final = await converge();
  assert.ok(final.startsWith('【Bob 插入】'), final);
  assert.ok(final.endsWith('繁體中文測試，標點符號。中'), final);
  assert.ok(!final.includes('ㄓ'), final);
  // cancelled composition (Esc) while a remote edit arrives: no stray Bopomofo, remote edit shown
  await caretTo(A, 'end');
  await cdp.send('Input.imeSetComposition', { text: 'ㄅ', selectionStart: 1, selectionEnd: 1 });
  await A.waitForFunction(() => window.__collab.binding.composing === true);
  await caretTo(B, 0);
  await B.keyboard.insertText('[取消測試]');
  await A.waitForFunction(() => window.__collab.text().startsWith('[取消測試]'));
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await A.waitForFunction(() => window.__collab.binding.composing === false);
  const after = await converge();
  assert.ok(after.startsWith('[取消測試]【Bob 插入】') && !after.includes('ㄅ'), after);
  const caret = await A.$eval('#notes', el => el.selectionStart);
  assert.equal(caret, after.length, 'caret stays at the end, not reset to 0');
});

test('undo/redo only affects my own edits', async () => {
  await caretTo(A, 'end');
  await A.keyboard.type(' UNDO-ME', { delay: 10 });
  await converge();
  await A.waitForTimeout(500); // close the undo capture window
  await A.keyboard.press('Control+z');
  let t = await converge();
  assert.ok(!t.includes('UNDO-ME'), t);
  assert.ok(t.includes('【Bob 插入】'), 'Bob edit untouched');
  await A.keyboard.press('Control+y');
  t = await converge();
  assert.ok(t.includes('UNDO-ME'), t);
});

test('offline via UI toggle: both sides edit, reconnect, nothing lost', async () => {
  await A.click('#btnConn');
  await B.click('#btnConn');
  await A.waitForFunction(() => document.body.dataset.conn === 'simulated');
  await B.waitForFunction(() => document.body.dataset.conn === 'simulated');
  await caretTo(A, 0);
  await A.keyboard.type('[A offline] ');
  await caretTo(B, 'end');
  await B.keyboard.type(' [B offline]');
  await A.fill('#taskInput', '離線新增的任務 A');
  await A.press('#taskInput', 'Enter');
  await B.click('#taskList .task:has-text("Bob") .del');
  await A.waitForSelector('#pending:not([hidden])');
  // still diverged while offline
  assert.notEqual(await text(A), await text(B));
  await A.click('#btnConn');
  await B.click('#btnConn');
  const final = await converge();
  assert.ok(final.startsWith('[A offline] '), final);
  assert.ok(final.endsWith(' [B offline]'), final);
  const tasks = await A.evaluate(() => __collab.tasks().map(t => t.text));
  assert.deepEqual(tasks.sort(), ['Alice 的任務', '離線新增的任務 A'].sort());
  await A.waitForSelector('#pending[hidden]', { state: 'attached' });
});

test('browser offline: reload from service-worker cache + IndexedDB, edit, back online', async () => {
  const before = await text(A);
  await A.evaluate(() => navigator.serviceWorker.ready); // app shell cached by sw.js
  allowConnErrors = true;
  await ctxA.setOffline(true);
  await A.reload();
  await A.waitForFunction(t => window.__collab?.isIdbSynced() && window.__collab.text() === t, before);
  assert.notEqual(await A.evaluate(() => __collab.status()), 'connected');
  await caretTo(A, 'end');
  await A.keyboard.type(' [after offline reload]');
  await ctxA.setOffline(false);
  await A.waitForFunction(() => window.__collab.status() === 'connected', null, { timeout: 15000 });
  allowConnErrors = false;
  const final = await converge();
  assert.ok(final.endsWith(' [after offline reload]'), final);
});

test('server hard kill (SIGKILL) + restart: data persists on disk', async () => {
  const expected = await converge();
  const expectedTasks = await A.evaluate(() => JSON.stringify(__collab.tasks()));
  await A.waitForTimeout(400); // let the append log reach the disk
  allowConnErrors = true;
  await stopServer('SIGKILL'); // no graceful flush: only the append log is on disk
  await A.waitForFunction(() => window.__collab.status() !== 'connected');
  // keep Alice and Bob away so the restarted server cannot be refilled by them
  await A.click('#btnConn');
  await B.click('#btnConn');
  srv = await startServer();
  // a brand-new user (empty IndexedDB) must get everything from the server's disk
  const ctxC = await browser.newContext();
  const C = await openUser(ctxC, 'Carol', '#2b8a3e');
  await C.waitForFunction(t => window.__collab.text() === t, expected);
  assert.equal(await C.evaluate(() => JSON.stringify(__collab.tasks())), expectedTasks);
  await A.click('#btnConn');
  await B.click('#btnConn');
  await A.waitForFunction(() => window.__collab.status() === 'connected', null, { timeout: 15000 });
  await B.waitForFunction(() => window.__collab.status() === 'connected', null, { timeout: 15000 });
  allowConnErrors = false;
  await A.waitForSelector('#presence li:has-text("Carol")');
  await ctxC.close();
});

test('version history: save, change, view, restore', async () => {
  const saved = await converge();
  await A.click('#btnHistory');
  await A.fill('#versionLabel', '測試版本');
  await A.click('#versionForm button[type=submit]');
  await A.waitForSelector('#versionList li:has-text("測試版本")');
  await A.click('#btnCloseHistory');
  await caretTo(B, 0);
  await B.keyboard.type('CHANGED ');
  await converge();
  await A.click('#btnHistory');
  await A.click('#versionList li:has-text("測試版本") button');
  await A.waitForSelector('#versionView:not([hidden])');
  assert.equal(await A.$eval('#versionNotes', el => el.textContent), saved);
  await A.click('#btnRestore');
  await A.click('#btnCloseHistory');
  assert.equal(await converge(), saved);
});

test('language toggle zh-TW <-> en and theme toggle', async () => {
  assert.equal(await A.$eval('h1', el => el.textContent), '協作筆記與任務板');
  assert.equal(await A.evaluate(() => document.documentElement.lang), 'zh-TW');
  await A.click('#btnLang');
  assert.equal(await A.$eval('h1', el => el.textContent), 'Collaborative Notes & Tasks');
  assert.equal(await A.evaluate(() => document.documentElement.lang), 'en');
  assert.equal(await A.$eval('#status', el => el.textContent), 'Connected · synced');
  await A.click('#btnLang');
  assert.equal(await A.$eval('h1', el => el.textContent), '協作筆記與任務板');
  const t0 = await A.evaluate(() => document.documentElement.dataset.theme);
  await A.click('#btnTheme');
  assert.notEqual(await A.evaluate(() => document.documentElement.dataset.theme), t0);
});

test('mobile width 390px: no horizontal scroll', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const M = await openUser(ctx, '手機使用者', '#9c36b5');
  const { sw, cw } = await M.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `scrollWidth ${sw} > clientWidth ${cw}`);
  await ctx.close();
});

test('debug mode: ?debug=1 shows the panel and logs via console.debug', async () => {
  const ctx = await browser.newContext();
  const D = await ctx.newPage();
  const debugMsgs = [];
  D.on('console', m => { if (m.type() === 'debug') debugMsgs.push(m.text()); if (m.type() === 'error') consoleErrors.push(`D: ${m.text()}`); });
  await D.goto(`http://127.0.0.1:${port}/?room=${ROOM}&name=Dbg&debug=1`);
  await D.waitForFunction(() => window.__collab?.status() === 'connected');
  await D.waitForSelector('#debugPanel:not([hidden])');
  await D.waitForFunction(() => document.getElementById('debugInfo').textContent.includes('"wsconnected": true'));
  assert.ok(debugMsgs.some(m => m.includes('[collab]') && m.includes('ws.sync')), debugMsgs.join('\n'));
  assert.ok(await D.evaluate(() => window.__collab.debugLines.length > 0));
  await ctx.close();
});

test('no unexpected console errors in any page', () => {
  assert.deepEqual(consoleErrors, []);
});
