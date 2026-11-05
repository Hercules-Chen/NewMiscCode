// UI verification with Playwright: starts the server in-process on a free port, searches,
// checks results, toggles language, and saves screenshots to examples/.
// Usage: node scripts/verify-ui.js [--no-shots]
// Playwright is NOT a dependency of this project. Install it once if missing:
//   npm i -D playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { resolveConfig, PROJECT_ROOT } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { startServer } from '../src/server.js';

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* fall through */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

const shots = !process.argv.includes('--no-shots');
const cfg = resolveConfig({});
const logger = new Logger({ logDir: cfg.logDir, consoleLevel: 'warn' });
const srv = await startServer(cfg, logger, { port: 0 });
const base = `http://127.0.0.1:${srv.port}/`;
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, locale: 'zh-TW' });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(base + '?lang=zh-TW');
  await page.fill('#q', '欄位加密連線失敗');
  await page.click('#go');
  await page.waitForSelector('.result');
  const paths = await page.$$eval('.result', (els) => els.map((e) => e.dataset.path));
  console.log('  hybrid results:', paths.slice(0, 5).join(', '));
  check(paths.slice(0, 3).includes('database/sql-always-encrypted.md'), 'hybrid: Always Encrypted note in top 3 for 欄位加密連線失敗');
  check((await page.textContent('h1')) === '本機語意搜尋', 'zh-TW UI title');
  check((await page.$$('.result mark')).length > 0, 'snippets contain <mark> highlights');
  if (shots) await page.screenshot({ path: path.join(PROJECT_ROOT, 'examples', 'ui-hybrid-zh.png') });

  // semantic-only, English UI, verbose on
  await page.click('#lang');
  check((await page.textContent('h1')) === 'Local Semantic Search', 'language toggle -> en');
  await page.selectOption('#mode', 'semantic');
  await page.check('#verbose');
  await page.fill('#q', '保護個資不讓管理員看到');
  await page.click('#go');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('results'));
  const sem = await page.$$eval('.result', (els) => els.map((e) => e.dataset.path));
  console.log('  semantic results:', sem.slice(0, 5).join(', '));
  check(sem[0] === 'database/sql-always-encrypted.md', 'semantic: Always Encrypted note ranked #1 for 保護個資不讓管理員看到');
  check(await page.isVisible('#debug'), 'verbose mode shows debug panel');
  if (shots) await page.screenshot({ path: path.join(PROJECT_ROOT, 'examples', 'ui-semantic-en-debug.png') });

  const dbg = await (await page.request.get(base + 'api/debug')).json();
  check(Array.isArray(dbg.recentLogs) && dbg.recentLogs.some((r) => r.event === 'search'), '/api/debug exposes recent JSONL log entries');
  check(consoleErrors.length === 0, `no browser console errors (${consoleErrors.length})`);
} finally {
  await browser.close();
  await srv.close();
  await logger.close();
}
console.log(failures ? `UI verification FAILED (${failures})` : 'UI verification OK');
process.exitCode = failures ? 1 : 0;
