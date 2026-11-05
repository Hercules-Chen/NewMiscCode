// Browser end-to-end test (Playwright + Chromium):
// start server.js, upload testdata via setInputFiles, check diagnosis rows,
// fix + download files and verify their bytes, zip download, language toggle,
// mobile layout, no console errors. Screenshots go to examples/.
// Usage: node test/e2e.mjs   (run "npm run build" first)
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(HERE, '..', '01-mcp-ui-verifier', 'node_modules', 'playwright')); }

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const TD = join(HERE, 'testdata');
const files = readdirSync(TD).filter(f => !f.endsWith('.bak')).sort();
mkdirSync(join(HERE, 'examples'), { recursive: true });

// --- server ---
const server = spawn(process.execPath, [join(HERE, 'server.js'), '--port', '0', '--quiet', '--log-dir', join(HERE, 'logs')], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((resolve, reject) => {
  let buf = '';
  server.stdout.on('data', d => { buf += d; const m = buf.match(/listening (http:\/\/\S+)/); if (m) resolve(m[1]); });
  server.on('exit', c => reject(new Error('server exited ' + c)));
  setTimeout(() => reject(new Error('server start timeout')), 10000);
});
console.log('server', base);

const browser = await pw.chromium.launch();
const errors = [];
const debugMsgs = [];
try {
  // MIME check
  const head = await fetch(base + 'encdoc.wasm', { method: 'HEAD' });
  check(head.headers.get('content-type') === 'application/wasm', 'server serves encdoc.wasm as application/wasm');

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'debug') debugMsgs.push(m.text()); });
  await page.goto(base + '?debug=1');
  await page.waitForSelector('#status[data-state="ready"]', { timeout: 30000 });
  check(true, 'wasm loaded: ' + await page.textContent('#status'));
  check(await page.evaluate(() => typeof window.encdocApp === 'object' && typeof window.encdoc.analyze === 'function'), 'window.encdocApp / window.encdoc exposed');

  await page.setInputFiles('#fileInput', files.map(f => join(TD, f)));
  await page.waitForFunction(n => document.querySelectorAll('#rows tr').length === n, files.length);
  check(true, `${files.length} rows rendered`);

  const row = name => page.locator(`#rows tr[data-file="${name}"]`);
  const enc = async name => row(name).getAttribute('data-encoding');
  const codes = async name => row(name).locator('[data-code]').evaluateAll(els => els.map(e => e.dataset.code));
  const expect = {
    'big5-notes.txt': ['big5', ['legacy-encoding']],
    'big5-readme.md': ['big5', ['not-utf8']],
    'gbk-simplified.txt': ['gbk', ['legacy-encoding']],
    'sjis-japanese.txt': ['shift_jis', ['legacy-encoding']],
    'no-bom.ps1': ['utf-8', ['ps1-bom-missing']],
    'bom-readme.md': ['utf-8', ['utf8-bom-unexpected']],
    'chinese-echo.bat': ['utf-8', ['bat-non-ascii', 'bat-eol']],
    'mixed-eol.js': ['utf-8', ['mixed-eol']],
    'mojibake-latin1.md': ['utf-8', ['mojibake']],
    'good.md': ['utf-8', []]
  };
  for (const [name, [e, c]] of Object.entries(expect)) {
    const ge = await enc(name), gc = await codes(name);
    check(ge === e && JSON.stringify(gc) === JSON.stringify(c), `row ${name}: ${ge} [${gc.join(',')}]`);
  }
  const big5Text = await row('big5-notes.txt').textContent();
  check(/big5\s+9\d%/.test(big5Text), 'big5 confidence shown (' + (big5Text.match(/big5\s+\d+%/) || [''])[0] + ')');
  const sum = await page.textContent('#sumText');
  check(/錯誤 \d+/.test(sum), 'summary (zh): ' + sum);
  await page.screenshot({ path: join(HERE, 'examples', '01-diagnosis-table.png') });

  // fix + download: no-bom.ps1 -> UTF-8 BOM + identical rest
  const dl = async (locator) => { const [d] = await Promise.all([page.waitForEvent('download'), locator.click()]); return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) }; };
  let got = await dl(row('no-bom.ps1').locator('button[data-act="fix"]'));
  const orig = readFileSync(join(TD, 'no-bom.ps1'));
  check(got.name === 'no-bom.ps1' && got.bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])) && got.bytes.subarray(3).equals(orig), 'fixed no-bom.ps1 = EF BB BF + original bytes');
  got = await dl(row('big5-readme.md').locator('button[data-act="fix"]'));
  check(got.bytes.toString('utf8').includes('說明文件') && got.bytes[0] !== 0xEF && got.bytes.toString('utf8').includes('\r\n'), 'fixed big5-readme.md is UTF-8 without BOM (CRLF kept)');
  got = await dl(row('mojibake-latin1.md').locator('button[data-act="fix"]'));
  check(got.bytes.toString('utf8') === '編碼醫生：這段文字原本是 UTF-8，請確認是否能正確還原。\n設定檔案已經儲存完成。\n', 'mojibake-latin1.md repaired exactly');

  // preview: decode big5 file as utf-8 vs big5
  await row('big5-notes.txt').locator('button[data-act="preview"]').click();
  await page.waitForSelector('#preview:not([hidden])');
  check((await page.textContent('#pvText')).includes('編碼醫生測試檔案'), 'preview (auto) shows Big5 text correctly');
  await page.selectOption('#pvEnc', 'utf-8');
  check((await page.textContent('#pvText')).includes('\uFFFD'), 'preview as utf-8 shows U+FFFD');
  await page.selectOption('#pvEnc', 'gbk');
  check(!(await page.textContent('#pvText')).includes('編碼醫生'), 'preview as gbk is garbled');
  await page.selectOption('#pvEnc', 'big5');
  // convert big5 -> utf-16le with BOM
  await page.selectOption('#cvTo', 'utf-16le');
  await page.check('#cvBom');
  got = await dl(page.locator('#cvBtn'));
  check(got.bytes[0] === 0xFF && got.bytes[1] === 0xFE && got.bytes.subarray(2).toString('utf16le').includes('編碼醫生'), 'convert big5 -> UTF-16LE + BOM download');
  await row('mojibake-latin1.md').locator('button[data-act="preview"]').click();
  check((await page.textContent('#pvFixed')).includes('編碼醫生：這段文字原本是 UTF-8'), 'mojibake preview shows repaired text');
  await page.locator('#preview').screenshot({ path: join(HERE, 'examples', '02-preview-mojibake.png') });

  // fix all -> zip
  got = await dl(page.locator('#fixAllBtn'));
  const entries = (got.bytes.toString('latin1').match(/PK\x01\x02/g) || []).length;
  const fixable = await page.evaluate(() => window.encdocApp.files.filter(f => f.report.fixable > 0).length);
  check(got.name === 'encdoc-fixed.zip' && got.bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'latin1')) && entries === fixable, `zip download: ${entries} entries (fixable files ${fixable})`);

  // language toggle
  await page.click('#langBtn');
  check((await page.textContent('#results thead')).includes('File') && (await page.textContent('#rows')).includes('must be UTF-8 with BOM'), 'English UI + English issue messages');
  check(await page.evaluate(() => document.documentElement.lang) === 'en', 'html lang=en');
  await page.click('#langBtn');
  check((await page.textContent('#results thead')).includes('檔案'), 'back to zh-TW');
  check(debugMsgs.some(m => m.includes('[encdoc]')), `?debug=1 console.debug output (${debugMsgs.length} messages)`);
  check(await page.isVisible('#debugPanel') && (await page.textContent('#debugLog')).includes('"event":"analyze"'), 'debug panel shows JSON log');
  // folder picker (webkitdirectory) and drag & drop
  await page.click('#clearBtn');
  check(await page.locator('#rows tr').count() === 0, 'clear removes all rows');
  await page.setInputFiles('#dirInput', TD);
  await page.waitForFunction(n => document.querySelectorAll('#rows tr').length === n, files.length);
  check(await page.locator('#rows tr[data-file="testdata/big5-notes.txt"]').getAttribute('data-encoding') === 'big5', `folder upload keeps relative paths (${files.length} rows)`);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([0xEF, 0xBB, 0xBF, 0x7B, 0x7D, 0x0A])], 'dropped.json'));
    const drop = document.getElementById('drop');
    drop.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    drop.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('#rows tr[data-file="dropped.json"] [data-code="utf8-bom-unexpected"]', { timeout: 5000 });
  check(true, 'drag & drop: dropped.json flagged utf8-bom-unexpected');
  await ctx.close();

  // mobile + dark
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  mp.on('console', msg => { if (msg.type() === 'error') errors.push('mobile: ' + msg.text()); });
  await mp.goto(base + '?lang=en');
  await mp.waitForSelector('#status[data-state="ready"]', { timeout: 30000 });
  await mp.setInputFiles('#fileInput', ['big5-notes.txt', 'chinese-echo.bat', 'no-bom.ps1', 'good.md'].map(f => join(TD, f)));
  await mp.waitForFunction(() => document.querySelectorAll('#rows tr').length === 4);
  const hscroll = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!hscroll, 'no horizontal page scroll at 390px');
  const bg = await mp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === 'rgb(18, 19, 20)', 'dark theme via prefers-color-scheme: ' + bg);
  await mp.screenshot({ path: join(HERE, 'examples', '03-mobile-dark-en.png') });
  await m.close();
} catch (e) {
  failures++;
  console.log('FAIL  exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
  server.kill();
}
check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
