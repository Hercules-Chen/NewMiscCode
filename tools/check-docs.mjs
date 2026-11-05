// Doc consistency checker for README.html files.
// Checks: relative href/src targets exist, #anchors exist, `npm run X` scripts exist,
// `node <file>` / referenced .bat/.ps1 files exist, and every tab renders without console errors.
// Usage: node tools/check-docs.mjs [--no-browser]
import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const docs = ['README.html', '01-mcp-ui-verifier/README.html', '02-local-semantic-search/README.html', '03-duckdb-wasm-dashboard/README.html'];
const exists = async p => access(p).then(() => true, () => false);
const problems = [];
let checks = 0;

for (const rel of docs) {
  const file = join(root, rel);
  if (!(await exists(file))) { console.log(`[skip] ${rel} (not found)`); continue; }
  const dir = dirname(file);
  const html = await readFile(file, 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // project folder = nearest folder with package.json (or none for root)
  const pkgPath = join(dir, 'package.json');
  const scripts = (await exists(pkgPath)) ? Object.keys(JSON.parse(await readFile(pkgPath, 'utf8')).scripts || {}) : null;

  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|data:|javascript:)/.test(url)) continue;
    checks++;
    if (url.startsWith('#')) { if (url.length > 1 && !ids.has(url.slice(1)) && !html.includes(`'${url}'`)) problems.push(`${rel}: anchor ${url} has no matching id`); continue; }
    const [pathPart, hash] = url.split('#');
    const target = join(dir, decodeURIComponent(pathPart));
    if (!(await exists(target))) { problems.push(`${rel}: link target missing: ${url}`); continue; }
    if (hash && target.endsWith('.html')) {
      const t = await readFile(target, 'utf8');
      if (!new RegExp(`\\sid="${hash}"`).test(t)) problems.push(`${rel}: ${url} -> id "${hash}" not found in target`);
    }
  }
  if (scripts) {
    for (const m of text.matchAll(/npm run ([\w:.-]+)/g)) {
      checks++;
      if (!scripts.includes(m[1])) problems.push(`${rel}: "npm run ${m[1]}" not in package.json scripts`);
    }
    for (const m of text.matchAll(/node (?:--[\w-]+ )*((?:src|scripts|test|tools|demo)\/[\w./-]+\.(?:m?js))/g)) {
      checks++;
      if (!(await exists(join(dir, m[1])))) problems.push(`${rel}: "node ${m[1]}" file missing`);
    }
    for (const m of new Set([...text.matchAll(/\b([\w-]+\.(?:bat|ps1|sh))\b/g)].map(x => x[1]))) {
      checks++;
      if (!(await exists(join(dir, m)))) problems.push(`${rel}: referenced launcher ${m} missing`);
    }
  }
}

if (!process.argv.includes('--no-browser')) {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require('playwright'); } catch { try { pw = require(join(root, '01-mcp-ui-verifier/node_modules/playwright')); } catch { pw = null; } }
  if (!pw) console.log('[warn] playwright not found; skipping render checks');
  else {
    const browser = await pw.chromium.launch();
    for (const rel of docs) {
      const file = join(root, rel);
      if (!(await exists(file))) continue;
      const page = await browser.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await page.goto(pathToFileURL(file).href);
      const tabs = await page.$$eval('nav a[href^="#"], .tabs a[href^="#"], [role=tab]', as => as.map(a => a.getAttribute('href') || a.id).filter(Boolean));
      for (const t of tabs) {
        checks++;
        if (t.startsWith('#')) { await page.evaluate(h => { location.hash = h; }, t); await page.waitForTimeout(50); }
      }
      const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      await page.setViewportSize({ width: 390, height: 800 });
      const hScrollMobile = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      if (hScrollMobile) problems.push(`${rel}: horizontal page scroll at 390px width`);
      for (const e of errs) problems.push(`${rel}: console/page error: ${e}`);
      console.log(`[render] ${rel}: tabs=${tabs.length} errors=${errs.length} hscroll(1280)=${hScroll} hscroll(390)=${hScrollMobile}`);
      await page.close();
    }
    await browser.close();
  }
}

console.log(`[check-docs] checks=${checks} problems=${problems.length}`);
for (const p of problems) console.log('  - ' + p);
process.exit(problems.length ? 1 : 0);
