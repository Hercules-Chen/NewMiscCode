// Regenerates examples/*.png with a temporary server + data dir (never touches your real data).
// Usage: npm run screenshots
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples');
const PORT = 8790 + Math.floor(Math.random() * 100);
const dataDir = await mkdtemp(join(tmpdir(), 'collab-shots-'));
await mkdir(OUT, { recursive: true });

const srv = spawn(process.execPath, ['src/server/index.js', '--port', String(PORT), '--data-dir', dataDir], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  let out = '';
  srv.stdout.on('data', d => { out += d; if (out.includes('server.listening')) res(); });
  srv.on('exit', c => rej(new Error('server exited ' + c)));
});

const browser = await chromium.launch();
const base = `http://127.0.0.1:${PORT}/?room=showcase`;
async function user(name, color, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 640, height: 600 }, deviceScaleFactor: 1, colorScheme: opts.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(`${base}&name=${encodeURIComponent(name)}&color=${encodeURIComponent(color)}&sw=0`);
  await page.waitForFunction(() => window.__collab?.status() === 'connected');
  return page;
}
const A = await user('小明', '#d9480f');
const B = await user('Bob', '#1971c2');

await A.click('#notes');
await A.keyboard.insertText('# 週會筆記 2026-11-05\n\n- 討論 **CRDT** 同步方案\n- 離線編輯後自動合併\n- [x] 伺服器持久化\n- [ ] 版本歷史\n\n');
await B.click('#notes');
await B.evaluate(() => { const t = document.getElementById('notes'); t.setSelectionRange(t.value.length, t.value.length); });
await B.keyboard.insertText('Bob: remote cursors work with Chinese IME too.\n');
await B.evaluate(() => { const t = document.getElementById('notes'); t.setSelectionRange(9, 13); });
for (const [p, txt] of [[A, '整理需求文件'], [B, 'Review sync server'], [A, '撰寫 Playwright 測試']]) { await p.fill('#taskInput', txt); await p.press('#taskInput', 'Enter'); }
await B.click('#taskList .task:has-text("整理需求") input[type=checkbox]');
await A.evaluate(() => { const t = document.getElementById('notes'); t.focus(); t.setSelectionRange(30, 30); });
await A.waitForTimeout(400);

async function sideBySide(pa, pb, file) {
  const [ia, ib] = [await pa.screenshot(), await pb.screenshot()];
  const ctx = await browser.newContext({ viewport: { width: 1296, height: 616 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#888;display:flex;gap:16px;padding:8px">
    <img src="data:image/png;base64,${ia.toString('base64')}" width="640"><img src="data:image/png;base64,${ib.toString('base64')}" width="640"></body>`);
  await p.screenshot({ path: join(OUT, file) });
  await ctx.close();
}
await sideBySide(A, B, 'two-users.png');

// offline: Bob simulates offline and keeps editing
await B.click('#btnConn');
await B.click('#notes');
await B.keyboard.insertText('（離線時新增的一行）\n');
await B.fill('#taskInput', '離線新增任務');
await B.press('#taskInput', 'Enter');
await B.waitForTimeout(300);
await sideBySide(A, B, 'offline-pending.png');
await B.click('#btnConn');
await A.waitForFunction(() => window.__collab.text().includes('離線時新增'));

// history dialog
const H = await user('小明', '#d9480f', { viewport: { width: 900, height: 640 } });
await H.click('#btnHistory');
await H.fill('#versionLabel', '週會定稿');
await H.click('#versionForm button[type=submit]');
await H.waitForSelector('#versionList li');
await H.click('#versionList li button');
await H.waitForSelector('#versionView:not([hidden])');
await H.screenshot({ path: join(OUT, 'history.png') });

// mobile + dark + English
const M = await user('Mobile', '#9c36b5', { viewport: { width: 390, height: 780 }, dark: true });
await M.click('#btnLang');
await M.screenshot({ path: join(OUT, 'mobile-dark-en.png') });

await browser.close();
srv.kill('SIGTERM');
await new Promise(r => srv.once('exit', r));
await rm(dataDir, { recursive: true, force: true });
for (const f of ['two-users.png', 'offline-pending.png', 'history.png', 'mobile-dark-en.png']) {
  console.log(`[shots] examples/${f} ${(await readFile(join(OUT, f))).length} bytes`);
}
