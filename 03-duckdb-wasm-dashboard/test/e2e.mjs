// End-to-end test: starts server.js, drives Chromium via Playwright, verifies the app.
// Run: npm test   (= node scripts/build.mjs && node test/e2e.mjs)
// Env: E2E_HEADED=1 to watch, E2E_KEEP=1 to keep test-output/.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-output');
const EXAMPLES = path.join(ROOT, 'examples');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  // globally installed playwright (NODE_PATH / npm root -g)
  const { execSync } = require('node:child_process');
  const groot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(groot, 'playwright'));
}

let failures = 0;
let passes = 0;
function check(cond, label, detail) {
  if (cond) { passes++; console.log('  PASS', label); } else { failures++; console.log('  FAIL', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}

async function startServer() {
  const child = spawn(process.execPath, ['server.js', '--port', '0', '--quiet', '--log-dir', path.join(OUT, 'logs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const url = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server start timeout: ' + buf)), 15000);
    child.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/listening (http:\/\/\S+)/);
      if (m) { clearTimeout(to); resolve(m[1]); }
    });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('exit', (c) => reject(new Error('server exited ' + c + ': ' + buf)));
  });
  return { child, url };
}

// ---------------------------------------------------------------- expected values computed in Node
async function expectedFromLog(file) {
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const errHours = new Map();
  const levels = new Map();
  const errMsgs = new Map();
  let slow = 0;
  for (const r of lines) {
    levels.set(r.level, (levels.get(r.level) || 0) + 1);
    if (r.elapsed_ms > 1000) slow++;
    if (r.level === 'ERROR') {
      const h = r.timestamp.slice(0, 13) + ':00:00';
      errHours.set(h, (errHours.get(h) || 0) + 1);
      errMsgs.set(r.message, (errMsgs.get(r.message) || 0) + 1);
    }
  }
  const hours = [...errHours.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const topErr = [...errMsgs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { total: lines.length, hours, levels, topErr, errMsgCount: errMsgs.size, slow, modules: new Set(lines.map((r) => r.module)).size };
}

async function waitIdle(page) {
  await page.waitForFunction(() => document.querySelector('#status').dataset.state !== 'running', null, { timeout: 30000 });
}
async function runPreset(page, id) {
  const before = await page.evaluate(() => window.DDB.state.seq);
  await page.click(`[data-preset="${id}"]`);
  await page.waitForFunction((b) => window.DDB.state.seq > b, before, { timeout: 30000 });
  return Number(await page.getAttribute('#rowCount', 'data-rows'));
}
async function gridRows(page) {
  return page.$$eval('#resultTable tbody tr', (trs) => trs.map((tr) => [...tr.cells].slice(1).map((c) => c.textContent)));
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(EXAMPLES, { recursive: true });
  const { chromium } = loadPlaywright();
  const { child, url } = await startServer();
  console.log('server', url);
  const browser = await chromium.launch(process.env.E2E_HEADED ? { headless: false } : {});
  const consoleErrors = [];
  const extRequests = [];
  try {
    // ============================================================ local variant
    console.log('\n[local variant]');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, acceptDownloads: true, locale: 'zh-TW', colorScheme: 'light' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[local] ' + m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('[local pageerror] ' + e.message));
    page.on('request', (r) => { if (/extensions\.duckdb\.org/.test(r.url())) extRequests.push(r.url()); });
    const t0 = Date.now();
    await page.goto(url + '?debug=1');
    await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
    check(await page.evaluate(() => document.body.dataset.ready) === '1', 'DuckDB-WASM initialised (' + (Date.now() - t0) + ' ms)');
    check(await page.isVisible('#debugPanel'), 'debug panel open with ?debug=1');
    check((await page.textContent('h1')) === 'DuckDB-WASM 資料分析台', 'default language is zh-TW');
    check(/DuckDB v\d/.test(await page.textContent('#ddbVersion')), 'version shown', await page.textContent('#ddbVersion'));

    // load sample log via file input
    const logFile = path.join(ROOT, 'public', 'sample', 'app-log.jsonl');
    const exp = await expectedFromLog(logFile);
    await page.setInputFiles('#fileInput', logFile);
    await page.waitForSelector('.schema-table[data-table="app_log"]', { timeout: 30000 });
    const schemaText = await page.textContent('.schema-table[data-table="app_log"]');
    check(schemaText.includes(String(exp.total.toLocaleString('en-US'))), 'schema panel shows app_log row count ' + exp.total, schemaText.slice(0, 80));
    check(/timestamp\s*TIMESTAMP/.test(schemaText), 'timestamp column sniffed as TIMESTAMP', schemaText.slice(0, 200));

    // every preset returns rows
    const presetIds = await page.evaluate(() => window.DDB.presets);
    const counts = {};
    for (const id of presetIds) {
      counts[id] = await runPreset(page, id);
      check(counts[id] > 0, `preset ${id} returns rows (${counts[id]})`);
    }
    // correctness vs. independent Node computation
    check(counts.errors_per_hour === exp.hours.length, 'errors_per_hour row count == ' + exp.hours.length, counts.errors_per_hour);
    check(counts.level_counts === exp.levels.size, 'level_counts row count == ' + exp.levels.size, counts.level_counts);
    check(counts.slowest_modules === exp.modules, 'slowest_modules row count == ' + exp.modules, counts.slowest_modules);
    check(counts.top_errors === Math.min(20, exp.errMsgCount), 'top_errors row count == ' + exp.errMsgCount, counts.top_errors);
    check(counts.slow_requests === Math.min(200, exp.slow), 'slow_requests row count == ' + exp.slow, counts.slow_requests);

    await runPreset(page, 'level_counts');
    const lv = await gridRows(page);
    const lvOk = lv.every(([level, n]) => exp.levels.get(level) === Number(n));
    check(lvOk && lv.length === exp.levels.size, 'level_counts values match Node', lv);

    await runPreset(page, 'top_errors');
    const te = (await gridRows(page))[0];
    check(te[0] === exp.topErr[0] && Number(te[1]) === exp.topErr[1], 'top error message matches Node: ' + exp.topErr.join(' x'), te);

    // errors_per_hour: full value comparison (all rows fit on a page of 50)
    await runPreset(page, 'errors_per_hour');
    const eph = await gridRows(page);
    const ephOk = eph.length === exp.hours.length && eph.every(([h, n], i) => h === exp.hours[i][0] && Number(n) === exp.hours[i][1]);
    check(ephOk, 'errors_per_hour every (hour, count) matches Node', eph.slice(0, 3));
    check(Number(await page.getAttribute('#rowCount', 'data-rows')) === exp.hours.length, 'row count label');
    check(/ms$/.test(await page.textContent('#queryTime')), 'query time shown', await page.textContent('#queryTime'));

    // chart (line, from preset hint)
    await page.click('.tab[data-view="chart"]');
    await page.waitForSelector('#chartSvg .chart-line');
    const pts = await page.$eval('#chartSvg .chart-line', (e) => e.getAttribute('points').split(' ').length);
    check(pts === exp.hours.length, 'line chart has one point per hour (' + pts + ')');
    await page.click('#debugClose');
    await page.locator('#chartBox').scrollIntoViewIfNeeded();
    await page.hover('#chartSvg', { position: { x: 400, y: 150 } });
    check(await page.isVisible('.chart-tip'), 'chart hover tooltip visible');
    await page.screenshot({ path: path.join(EXAMPLES, '01-errors-per-hour-chart.png') });

    // bar chart
    await runPreset(page, 'slowest_modules');
    await page.waitForSelector('#chartSvg .chart-bar');
    const bars = await page.$$eval('#chartSvg .chart-bar', (b) => b.length);
    check(bars === exp.modules, 'bar chart has one bar per module (' + bars + ')');
    await page.click('.tab[data-view="table"]');

    // paging (slow_requests > 50 rows)
    await runPreset(page, 'slow_requests');
    check(await page.isVisible('#pager'), 'pager visible for > page size');
    const firstPage = (await gridRows(page)).length;
    await page.click('#nextBtn');
    const info = await page.textContent('#pageInfo');
    check(firstPage === 50 && /2 \//.test(info), 'paging next works: ' + info);

    // CSV export
    await runPreset(page, 'errors_per_hour');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    const csvPath = path.join(OUT, 'export.csv');
    await dl.saveAs(csvPath);
    const csvBuf = await fs.readFile(csvPath);
    const csvText = csvBuf.toString('utf8');
    check(csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF, 'export has UTF-8 BOM (Excel option on)');
    const csvLines = csvText.replace(/^\uFEFF/, '').trim().split(/\r\n/);
    check(csvLines[0] === 'hour,errors' && csvLines.length === exp.hours.length + 1, 'exported CSV header + rows', csvLines.slice(0, 2));
    check(csvLines[1] === `${exp.hours[0][0]},${exp.hours[0][1]}`, 'exported CSV first row matches Node', csvLines[1]);

    // CSV & XLSX loading
    await page.setInputFiles('#fileInput', path.join(ROOT, 'public', 'sample', 'sales.csv'));
    await page.waitForSelector('.schema-table[data-table="sales"]');
    const r = await page.evaluate(async () => (await window.DDB.runQuery("SELECT count(*) AS n, count(DISTINCT region) AS r FROM sales")).rowCount);
    const salesRow = await gridRows(page);
    check(r === 1 && salesRow[0][0] === '400' && salesRow[0][1] === '5', 'sales.csv loaded (400 rows, 5 regions incl. 台北)', salesRow);
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'score'], ['王小明', 90], ['Alice', 85], ['Bob', 70]]), 'Scores');
    const xlsxPath = path.join(OUT, 'scores.xlsx');
    XLSX.writeFile(wb, xlsxPath);
    await page.setInputFiles('#fileInput', xlsxPath);
    await page.waitForSelector('.schema-table[data-table="scores"]', { timeout: 30000 });
    await page.evaluate(() => window.DDB.runQuery('SELECT name, score FROM scores ORDER BY score DESC'));
    const sc = await gridRows(page);
    check(sc.length === 3 && sc[0][0] === '王小明' && sc[0][1] === '90', 'xlsx loaded via SheetJS', sc);

    // error path is shown and logged (not thrown)
    await page.evaluate(() => window.DDB.runQuery('SELECT * FROM no_such_table'));
    check(await page.isVisible('#queryError'), 'SQL error displayed in result area');
    const dbg = await page.evaluate(() => window.__ddbDebug.map((e) => e.kind));
    check(dbg.includes('error') && dbg.filter((k) => k === 'query').length > 10, 'debug log has queries and the error (' + dbg.length + ' entries)');
    await page.click('#debugBtn');
    check(await page.isVisible('#debugPanel') && (await page.$$eval('#debugList li', (l) => l.length)) > 10, 'debug panel toggles open and lists entries');

    // language switch
    await page.evaluate(() => window.DDB.runPreset('slowest_modules'));
    await waitIdle(page);
    await page.click('#langBtn');
    check((await page.textContent('h1')) === 'DuckDB-WASM Data Desk' && (await page.getAttribute('html', 'lang')) === 'en', 'switched to English');
    check((await page.textContent('[data-preset="errors_per_hour"]')) === 'Errors per hour', 'preset labels translated');
    await page.screenshot({ path: path.join(EXAMPLES, '02-english-results-debug.png') });
    await page.click('#langBtn');
    check((await page.getAttribute('html', 'lang')) === 'zh-TW', 'switched back to zh-TW');
    await ctx.close();

    // mobile + dark
    console.log('\n[mobile / dark]');
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const mp = await mctx.newPage();
    mp.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[mobile] ' + m.text()); });
    mp.on('pageerror', (e) => consoleErrors.push('[mobile pageerror] ' + e.message));
    await mp.goto(url);
    await mp.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    await mp.click('#sampleLogBtn');
    await mp.waitForFunction(() => window.DDB.state.result && window.DDB.state.result.sql.includes('Errors per hour'), null, { timeout: 30000 });
    check(Number(await mp.getAttribute('#rowCount', 'data-rows')) === exp.hours.length, 'in-browser generated sample == committed sample file (same row count)');
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, 'no horizontal page scroll at 390px', overflow);
    const bg = await mp.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg === 'rgb(18, 18, 17)', 'dark theme applied', bg);
    await mp.click('.tab[data-view="chart"]');
    await mp.waitForSelector('#chartSvg');
    await mp.screenshot({ path: path.join(EXAMPLES, '03-mobile-dark.png'), fullPage: false });
    await mctx.close();

    // ============================================================ artifact variant (jsDelivr mocked from node_modules)
    console.log('\n[dist/artifact.html variant, jsDelivr served from node_modules via request interception]');
    const actx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const ddbDist = path.join(ROOT, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
    const ddbVer = JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules', '@duckdb', 'duckdb-wasm', 'package.json'), 'utf8')).version;
    const cdnHits = [];
    await actx.route('https://cdn.jsdelivr.net/npm/**', async (route) => {
      const u = new URL(route.request().url());
      cdnHits.push(u.pathname);
      const m = u.pathname.match(/^\/npm\/@duckdb\/duckdb-wasm@([^/]+)\/dist\/(.+)$/);
      const mx = u.pathname.match(/^\/npm\/xlsx@[^/]+\/dist\/(.+)$/);
      let file = null;
      if (m && m[1] === ddbVer) file = path.join(ddbDist, m[2]);
      else if (mx) file = path.join(ROOT, 'node_modules', 'xlsx', 'dist', mx[1]);
      if (!file) return route.fulfill({ status: 404, body: 'not mocked' });
      const body = await fs.readFile(file);
      const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      return route.fulfill({ status: 200, body, headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
    });
    const artifactHtml = await fs.readFile(path.join(ROOT, 'dist', 'artifact.html'));
    await actx.route('https://artifact.example/**', (route) => route.fulfill({ status: 200, body: artifactHtml, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const ap = await actx.newPage();
    ap.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('[artifact] ' + m.text()); });
    ap.on('pageerror', (e) => consoleErrors.push('[artifact pageerror] ' + e.message));
    ap.on('request', (r) => { const u = r.url(); if (!/^(https:\/\/(cdn\.jsdelivr\.net|artifact\.example)\/|data:|blob:)/.test(u)) extRequests.push('[artifact] ' + u); });
    await ap.goto('https://artifact.example/artifact.html');
    await ap.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
    check(await ap.evaluate(() => document.body.dataset.ready) === '1', 'artifact.html: DuckDB-WASM initialised from (mocked) jsDelivr');
    check(cdnHits.some((p) => p.endsWith('.wasm')) && cdnHits.some((p) => p.endsWith('.worker.js')), 'artifact.html fetched wasm + worker from cdn.jsdelivr.net', cdnHits);
    const localRefs = await ap.evaluate(() => [...document.querySelectorAll('script[src],link[href]')].map((e) => e.src || e.href).filter((u) => !u.startsWith('data:')));
    check(localRefs.length === 0, 'artifact.html has no external script/link tags (self-contained)', localRefs);
    await ap.click('#sampleLogBtn');
    await ap.waitForFunction(() => window.DDB.state.result && window.DDB.state.result.sql.includes('Errors per hour'), null, { timeout: 30000 });
    check(Number(await ap.getAttribute('#rowCount', 'data-rows')) === exp.hours.length, 'artifact.html: sample log + errors_per_hour preset correct');
    await actx.close();

    check(extRequests.length === 0, 'no requests to extensions.duckdb.org or other hosts', extRequests);
  } finally {
    await browser.close();
    child.kill();
  }

  // server request log written?
  const logs = await fs.readdir(path.join(OUT, 'logs')).catch(() => []);
  const logText = logs.length ? await fs.readFile(path.join(OUT, 'logs', logs[0]), 'utf8') : '';
  const first = logText.split('\n')[0];
  let parsed = null; try { parsed = JSON.parse(first); } catch { /* */ }
  check(parsed && parsed.method === 'GET' && typeof parsed.ms === 'number', 'server wrote JSONL request log', first);
  check(/application\/wasm/.test(await fetchType(url)), 'server serves .wasm as application/wasm');

  check(consoleErrors.length === 0, 'no console errors', consoleErrors);
  console.log(`\n${passes} passed, ${failures} failed`);
  if (!process.env.E2E_KEEP) await fs.rm(OUT, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

async function fetchType(url) {
  // server was killed already; start a short-lived one for the header check
  const { child, url: u2 } = await startServer();
  try {
    const r = await fetch(u2 + 'vendor/duckdb-eh.wasm', { method: 'HEAD' });
    return r.headers.get('content-type') || '';
  } finally { child.kill(); }
}

main().catch((e) => { console.error('E2E crashed:', e); process.exit(2); });
