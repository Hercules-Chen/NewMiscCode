// run.js - `vr run` (screenshot pages with Playwright, compare with baselines via wasm, write report)
// and `vr approve` (promote current screenshots to baseline).
import { readFile, writeFile, mkdir, copyFile, readdir, access } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCore } from './core.js';
import { loadPlaywright } from './pw.js';
import { buildReport } from './report.js';
import { parseRect } from '../web/vrcore.js';

const exists = (p) => access(p).then(() => true, () => false);

export async function loadConfig(configPath) {
  const cfg = JSON.parse(await readFile(configPath, 'utf8'));
  if (!Array.isArray(cfg.pages) || cfg.pages.length === 0) throw new Error(`config ${configPath}: "pages" must be a non-empty array`);
  for (const p of cfg.pages) {
    if (!p.name || !/^[\w.-]+$/.test(p.name)) throw new Error(`config: invalid page name "${p.name}" (letters, digits, _ . - only)`);
    if (!p.path && !p.url) throw new Error(`config: page "${p.name}" needs "path" or "url"`);
  }
  return cfg;
}

/** Resolve the URL of a page: absolute url wins; else site (dir or http base) + path. */
export function pageUrl(page, site) {
  if (page.url && /^(https?|file):/.test(page.url)) return page.url;
  const rel = page.path || page.url;
  if (/^https?:\/\//.test(site)) return new URL(rel, site.endsWith('/') ? site : site + '/').href;
  return pathToFileURL(resolve(site, rel)).href;
}

export function dirsFor(outDir, baselineDir) {
  return {
    baseline: resolve(baselineDir || join(outDir, 'baseline')),
    current: join(outDir, 'current'),
    diff: join(outDir, 'diff'),
  };
}

/**
 * Screenshot every page, compare with baseline, write diff PNGs + report.html + report.json.
 * @returns {Promise<{results:Array, reportPath:string, jsonPath:string, exitCode:number}>}
 */
export async function runSuite({ configPath, site, outDir, baselineDir, threshold, lang = 'zh-TW', log, extraIgnore = [] }) {
  const cfg = await loadConfig(configPath);
  const siteRoot = site || cfg.site || dirname(configPath);
  const siteAbs = /^https?:\/\//.test(siteRoot) ? siteRoot : resolve(siteRoot);
  const dirs = dirsFor(outDir, baselineDir || (cfg.baselineDir && resolve(dirname(configPath), cfg.baselineDir)));
  await Promise.all(Object.values(dirs).map(d => mkdir(d, { recursive: true })));
  const thr = threshold ?? cfg.threshold ?? 0.1;
  const core = await loadCore();
  const pw = await loadPlaywright();
  log.info('run start', { site: siteAbs, pages: cfg.pages.length, threshold: thr, outDir, baselineDir: dirs.baseline });
  const browser = await pw.chromium.launch();
  const results = [];
  try {
    const ctx = await browser.newContext({ viewport: cfg.viewport || { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'zh-TW' });
    const page = await ctx.newPage();
    page.on('console', m => log.debug('page console', { type: m.type(), text: m.text() }));
    for (const p of cfg.pages) {
      const url = pageUrl(p, siteAbs);
      const t0 = Date.now();
      const files = { baseline: join(dirs.baseline, `${p.name}.png`), current: join(dirs.current, `${p.name}.png`), diff: join(dirs.diff, `${p.name}.png`) };
      const r = { name: p.name, url, status: 'error', files: {}, ignore: [] };
      try {
        await page.goto(url, { waitUntil: 'load' });
        await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
        const selectors = [...(cfg.ignoreSelectors || []), ...(p.ignoreSelectors || [])];
        const selRects = selectors.length ? await page.evaluate((sels) => {
          const out = [];
          for (const s of sels) for (const el of document.querySelectorAll(s)) {
            const b = el.getBoundingClientRect();
            const x = Math.max(0, Math.floor(b.left + scrollX) - 2), y = Math.max(0, Math.floor(b.top + scrollY) - 2);
            out.push({ x, y, w: Math.ceil(b.width) + 4, h: Math.ceil(b.height) + 4, selector: s });
          }
          return out;
        }, selectors) : [];
        r.ignore = [...selRects, ...[...(cfg.ignore || []), ...(p.ignore || []), ...extraIgnore].map(v => typeof v === 'string' ? parseRect(v) : v)];
        const shot = await page.screenshot({ fullPage: cfg.fullPage !== false, animations: 'disabled', caret: 'hide' });
        await writeFile(files.current, shot);
        r.files.current = files.current;
        if (await exists(files.baseline)) {
          const base = await readFile(files.baseline);
          const { stats, diffPng, ms } = await core.compare(base, shot, { threshold: thr, gap: p.gap ?? cfg.gap ?? 8, includeAA: !!cfg.includeAA, ignore: r.ignore });
          await writeFile(files.diff, diffPng);
          r.files.baseline = files.baseline;
          r.files.diff = files.diff;
          r.stats = stats;
          r.compareMs = Math.round(ms * 100) / 100;
          r.status = stats.diffPixels > 0 ? 'changed' : 'pass';
        } else {
          r.status = 'new';
        }
      } catch (err) {
        r.error = err.message;
        log.error('page failed', { name: p.name, url, error: err.message });
      }
      r.ms = Date.now() - t0;
      log.info('page done', { name: p.name, status: r.status, diffPixels: r.stats?.diffPixels, boxes: r.stats?.boxes.length, ms: r.ms });
      results.push(r);
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  const meta = { generatedAt: new Date().toISOString(), site: siteAbs, config: configPath, threshold: thr, coreVersion: core.version, outDir, baselineDir: dirs.baseline };
  const reportPath = join(outDir, 'report.html');
  const jsonPath = join(outDir, 'report.json');
  await writeFile(jsonPath, JSON.stringify({ meta, results }, null, 2) + '\n', 'utf8');
  await writeFile(reportPath, await buildReport({ results, meta, lang }), 'utf8');
  const exitCode = results.every(r => r.status === 'pass') ? 0 : 1;
  log.info('run done', { reportPath, exitCode, summary: results.map(r => `${r.name}:${r.status}`).join(',') });
  return { results, reportPath, jsonPath, exitCode };
}

/** Copy current/<name>.png to the baseline dir (all, or only `names`). */
export async function approve({ outDir, baselineDir, names = [], log }) {
  const dirs = dirsFor(outDir, baselineDir);
  await mkdir(dirs.baseline, { recursive: true });
  let files;
  try { files = (await readdir(dirs.current)).filter(f => f.endsWith('.png')); } catch { files = []; }
  if (names.length) files = files.filter(f => names.includes(basename(f, '.png')));
  for (const f of files) {
    await copyFile(join(dirs.current, f), join(dirs.baseline, f));
    log.info('approved', { file: f, baseline: join(dirs.baseline, f) });
  }
  return { approved: files.map(f => basename(f, '.png')), baselineDir: dirs.baseline };
}
