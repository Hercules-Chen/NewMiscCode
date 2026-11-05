// report.js - build a single self-contained HTML report (images embedded as data: URIs,
// viewer + i18n code inlined from web/viewer.js and web/i18n.js). No network needed to open it.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './paths.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function dataUri(file) {
  if (!file) return null;
  try { return 'data:image/png;base64,' + (await readFile(file)).toString('base64'); } catch { return null; }
}

/**
 * @param {{results:Array, meta:object, lang?:string}} o
 * @returns {Promise<string>} HTML
 */
export async function buildReport({ results, meta, lang = 'zh-TW' }) {
  const [viewerJs, i18nJs] = await Promise.all([
    readFile(join(ROOT, 'web', 'viewer.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'i18n.js'), 'utf8'),
  ]);
  const pages = [];
  for (const r of results) {
    pages.push({
      name: r.name, url: r.url, status: r.status, error: r.error || null, stats: r.stats || null, ms: r.ms,
      ignore: r.ignore || [],
      baseline: await dataUri(r.files?.baseline), current: await dataUri(r.files?.current), diff: await dataUri(r.files?.diff),
    });
  }
  const data = JSON.stringify({ meta, lang, pages }).replace(/</g, '\\u003c');
  const counts = { pass: 0, changed: 0, new: 0, error: 0 };
  for (const p of pages) counts[p.status] = (counts[p.status] || 0) + 1;

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>視覺回歸報告 Visual Regression Report</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--muted:#5b6475;--line:#d5d9e0}
*{box-sizing:border-box}
html,body{margin:0;overflow-x:hidden}
body{font:15px/1.55 "Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;background:#212f4d;color:#fff}
header h1{margin:0;font-size:1.25rem}
header button{border:1px solid #fff;background:transparent;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
main{max-width:1200px;margin:0 auto;padding:16px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px}
.summary div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.summary b{display:block;font-size:1.4rem}
.meta{color:var(--muted);font-size:.85rem;word-break:break-all}
.page{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:14px 0}
.page h2{margin:0;font-size:1.1rem;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.badge{font-size:.75rem;border-radius:10px;padding:2px 8px;color:#fff;background:#888}
.badge.pass{background:#11813b}.badge.changed{background:#e6141e}.badge.new{background:#1f6feb}.badge.error{background:#7a2e00}
.stats{font-size:.9rem;margin:6px 0}
.boxes{font-family:Consolas,monospace;font-size:.85rem;margin:4px 0 8px;padding-left:22px}
.url{font-size:.8rem;color:var(--muted);word-break:break-all}
.newimg img{max-width:100%;border:1px solid var(--line)}
${'' /* viewer CSS appended at runtime from VIEWER_CSS */}
</style>
</head>
<body>
<header><h1 data-i18n="report.title">視覺回歸報告</h1><button type="button" id="langBtn" data-i18n="lang.toggle">English</button></header>
<main>
  <section class="summary" id="summary">
    <div><span data-i18n="report.pages"></span><b id="cPages">${pages.length}</b></div>
    <div><span data-i18n="report.passed"></span><b id="cPass">${counts.pass}</b></div>
    <div><span data-i18n="report.changed"></span><b id="cChanged">${counts.changed}</b></div>
    <div><span data-i18n="report.new"></span><b id="cNew">${counts.new}</b></div>
    <div><span data-i18n="report.error"></span><b id="cError">${counts.error}</b></div>
  </section>
  <p class="meta"><span data-i18n="report.generated"></span>: ${esc(meta.generatedAt || '')} · site: ${esc(meta.site || '')} · threshold ${esc(meta.threshold ?? '')} · vr-core ${esc(meta.coreVersion || '')}</p>
  <p class="meta" data-i18n="report.approveHint"></p>
  <div id="pages"></div>
</main>
<script type="application/json" id="vr-data">${data}</script>
<script type="module">
${i18nJs}
${viewerJs}
const DATA = JSON.parse(document.getElementById('vr-data').textContent);
const st = document.createElement('style'); st.textContent = VIEWER_CSS; document.head.appendChild(st);
let lang = (new URLSearchParams(location.search).get('lang')) || DATA.lang || 'zh-TW';
if (!LANGS.includes(lang)) lang = 'zh-TW';
const viewers = [];
function render() {
  const t = applyI18n(document, lang);
  const host = document.getElementById('pages');
  host.innerHTML = '';
  viewers.length = 0;
  for (const p of DATA.pages) {
    const sec = document.createElement('section');
    sec.className = 'page';
    sec.id = 'page-' + p.name;
    sec.dataset.status = p.status;
    const s = p.stats;
    const statsLine = s ? \`\${t('stats.diffPixels')}: <b>\${s.diffPixels}</b> · \${t('stats.percent')}: <b>\${s.percent}%</b> · \${t('stats.boxes')}: <b class="box-count">\${s.boxes.length}</b> · \${t('stats.size')}: \${s.width} x \${s.height}\` : '';
    const boxes = s && s.boxes.length ? '<ol class="boxes">' + s.boxes.map(b => \`<li>x=\${b.x} y=\${b.y} w=\${b.w} h=\${b.h} (\${b.pixels} px)</li>\`).join('') + '</ol>' : '';
    sec.innerHTML = \`<h2>\${p.name.replace(/</g, '&lt;')} <span class="badge \${p.status}">\${t('report.status.' + p.status)}</span></h2>
      <div class="url">\${t('report.url')}: \${String(p.url).replace(/</g, '&lt;')}</div>
      <div class="stats">\${statsLine}\${p.error ? ' ' + String(p.error).replace(/</g, '&lt;') : ''}</div>\${boxes}<div class="view"></div>\`;
    host.appendChild(sec);
    const view = sec.querySelector('.view');
    if (p.baseline && p.current && p.diff && s) {
      viewers.push(mountViewer(view, { baseline: p.baseline, current: p.current, diff: p.diff, boxes: s.boxes, width: s.width, height: s.height, mode: p.status === 'changed' ? 'slider' : 'side', t }));
    } else if (p.current) {
      view.innerHTML = '<p>' + t('report.noBaseline') + '</p><div class="newimg"><img alt="current" src="' + p.current + '"></div>';
    }
  }
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
}
document.getElementById('langBtn').addEventListener('click', () => { lang = lang === 'zh-TW' ? 'en' : 'zh-TW'; render(); });
render();
window.VR_REPORT = { data: DATA, viewers, setLang(l) { lang = l; render(); } };
</script>
</body>
</html>
`;
}
