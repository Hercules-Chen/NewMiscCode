// Self-contained HTML report (screenshots embedded as data: URIs). zh-TW / en.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { t } from './i18n.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function dataUri(file) {
  try {
    const buf = await fsp.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

/** Build the report HTML string from a VerifierSession (or a plain object with the same fields). */
export async function buildReportHtml(s) {
  const L = s.lang;
  const T = (k, v) => esc(t(L, k, v));
  const sum = s.summary();
  const statusBadge = (st) => `<span class="badge ${st}">${T(st === 'pass' ? 'report.pass' : st === 'fail' ? 'report.fail' : 'report.skip')}</span>`;
  const shotId = (rel) => 'shot-' + rel.replace(/[^a-zA-Z0-9]+/g, '-');
  const images = new Map();
  for (const sh of s.screenshots) images.set(sh.rel, await dataUri(sh.file));

  const stepRows = s.steps.map((r) => `
      <tr class="row-${r.status}" id="step-${r.no}">
        <td>${r.no}</td><td>${statusBadge(r.status)}</td>
        <td>${T('step.' + r.action) !== esc('step.' + r.action) ? T('step.' + r.action) : esc(r.action)}<br><code class="act">${esc(r.action)}</code></td>
        <td><code>${esc(r.target)}</code></td>
        <td>${esc(r.message)}</td>
        <td class="num">${r.durationMs}</td>
        <td>${r.screenshot ? `<a href="#${shotId(r.screenshot)}" data-tab="screenshots">${T('report.viewShot')}</a>` : ''}</td>
      </tr>`).join('');

  const failures = s.steps.filter((r) => r.status === 'fail');
  const failList = failures.length
    ? `<ul class="fails">${failures.map((r) => `<li><a href="#step-${r.no}" data-tab="steps">#${r.no}</a> <code>${esc(r.action)}</code> <code>${esc(r.target)}</code> — ${esc(r.message)}${r.screenshot ? ` · <a href="#${shotId(r.screenshot)}" data-tab="screenshots">${T('report.viewShot')}</a>` : ''}</li>`).join('')}</ul>`
    : `<p>${T('report.noFailures')}</p>`;

  const shots = s.screenshots.length
    ? s.screenshots.map((sh) => {
        const step = s.steps.find((r) => r.screenshot === sh.rel);
        return `
      <figure id="${shotId(sh.rel)}" class="shot ${step ? 'row-' + step.status : ''}">
        <figcaption>${step ? `${statusBadge(step.status)} <a href="#step-${step.no}" data-tab="steps">#${step.no}</a> ` : ''}${esc(sh.label)}<br><small><code>${esc(sh.rel)}</code></small></figcaption>
        <img src="${images.get(sh.rel)}" alt="${esc(sh.label)}" loading="lazy">
      </figure>`;
      }).join('')
    : `<p>${T('report.noShots')}</p>`;

  const consoleRows = s.console.length
    ? `<table><thead><tr><th>${T('report.col.at')}</th><th>${T('report.col.type')}</th><th>${T('report.col.text')}</th><th>${T('report.col.location')}</th></tr></thead><tbody>${s.console
        .map((e) => `<tr class="sev-${esc(e.severity)}"><td class="nowrap">${esc(e.at.slice(11, 23))}</td><td><span class="badge ${e.severity === 'error' ? 'fail' : 'warn'}">${esc(e.type)}</span></td><td><pre>${esc(e.text)}</pre></td><td><code>${esc(e.location)}</code></td></tr>`)
        .join('')}</tbody></table>`
    : `<p>${T('report.noConsole')}</p>`;

  const timings = s.pageTimings.length
    ? `<table><thead><tr><th>${T('report.timing.url')}</th><th>${T('report.timing.ttfb')}</th><th>${T('report.timing.dcl')}</th><th>${T('report.timing.load')}</th></tr></thead><tbody>${s.pageTimings
        .map((p) => `<tr><td><code>${esc(p.url)}</code></td><td class="num">${p.ttfb}</td><td class="num">${p.dcl}</td><td class="num">${p.load || '-'}</td></tr>`)
        .join('')}</tbody></table>`
    : `<p>${T('report.env.none')}</p>`;

  const opts = { ...s.opts };
  const envRows = [
    ['report.env.scenario', esc(s.name)],
    ['report.env.browser', esc(s.browserVersion)],
    ['report.env.viewport', esc(`${opts.viewport?.width}×${opts.viewport?.height}`)],
    ['report.env.start', esc(s.startedAt?.toISOString() || '')],
    ['report.env.end', esc(s.endedAt?.toISOString() || '')],
    ['report.env.outDir', `<code>${esc(s.runDir)}</code>`],
    ['report.env.log', `<code>${esc(s.logFile)}</code>`],
    ['report.env.trace', s.tracePath ? `<code>${esc(s.tracePath)}</code><br><small><code>npx playwright show-trace "${esc(s.tracePath)}"</code></small>` : T('report.env.none')],
    ['report.env.options', `<pre>${esc(JSON.stringify({ lang: opts.lang, headed: opts.headed, devtools: opts.devtools, debug: opts.debug, trace: opts.trace, slowMo: opts.slowMo, timeout: opts.timeout, baseUrl: opts.baseUrl, cdpPort: opts.cdpPort, logLevel: opts.logLevel }, null, 2))}</pre>`],
  ].map(([k, v]) => `<tr><th>${T(k)}</th><td>${v}</td></tr>`).join('');

  const overall = sum.ok ? 'pass' : 'fail';
  const tabs = [
    ['summary', t(L, 'report.tab.summary')],
    ['steps', `${t(L, 'report.tab.steps')} (${sum.total})`],
    ['screenshots', `${t(L, 'report.tab.screenshots')} (${s.screenshots.length})`],
    ['console', `${t(L, 'report.tab.console')} (${s.console.length})`],
    ['env', t(L, 'report.tab.env')],
  ];

  return `<!DOCTYPE html>
<html lang="${L === 'en' ? 'en' : 'zh-Hant-TW'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T('report.title')} — ${esc(s.name)}</title>
<style>
:root{--bg:#f6f7f9;--fg:#1d2330;--muted:#5d6675;--card:#fff;--line:#dfe3ea;--pass:#147a3d;--passbg:#e3f5ea;--fail:#c40000;--failbg:#fde8e8;--skip:#7a6a00;--skipbg:#fff7d1;--accent:#2457c5}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ef;--muted:#9aa3b2;--card:#1d2128;--line:#323844;--passbg:#163524;--failbg:#3d1a1a;--skipbg:#3a3415;--pass:#4fd08a;--fail:#ff7b7b;--skip:#e6cf5a;--accent:#7aa2ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Microsoft JhengHei","PingFang TC","Noto Sans CJK TC","Segoe UI",sans-serif}
header{padding:20px 24px 0;max-width:1280px;margin:auto}
h1{margin:0 0 4px;font-size:24px}
.meta{color:var(--muted);font-size:13px}
nav.tabs{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 24px 0;display:flex;gap:4px;flex-wrap:wrap;max-width:1280px;margin:12px auto 0}
nav.tabs a{padding:8px 14px;border:1px solid var(--line);border-bottom:none;border-radius:8px 8px 0 0;text-decoration:none;color:var(--fg);background:var(--card);opacity:.75}
nav.tabs a.active{opacity:1;font-weight:bold;border-color:var(--accent);box-shadow:inset 0 3px 0 var(--accent)}
main{max-width:1280px;margin:auto;padding:16px 24px 48px}
section.tab{display:none}
section.tab.active{display:block}
.no-js section.tab{display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card .v{font-size:26px;font-weight:bold}
.card .k{color:var(--muted);font-size:13px}
.overall{font-size:20px;font-weight:bold;padding:12px 16px;border-radius:10px}
.overall.pass{background:var(--passbg);color:var(--pass)}
.overall.fail{background:var(--failbg);color:var(--fail)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:rgba(127,127,127,.08);white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.nowrap{white-space:nowrap}
tr.row-fail td{background:var(--failbg)}
tr.row-skip td{background:var(--skipbg)}
.badge{display:inline-block;white-space:nowrap;padding:0 8px;border-radius:999px;font-size:12px;font-weight:bold;color:#fff}
.badge.pass{background:var(--pass)}.badge.fail{background:var(--fail)}.badge.skip,.badge.warn{background:var(--skip)}
@media (prefers-color-scheme:dark){.badge{color:#111}}
code{font-family:Consolas,"Cascadia Mono",monospace;font-size:13px;word-break:break-all}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:Consolas,"Cascadia Mono",monospace;font-size:13px}
a{color:var(--accent)}
figure.shot{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:0 0 18px}
figure.shot.row-fail{border-color:var(--fail);border-width:2px}
figure.shot img{max-width:100%;display:block;margin-top:8px;border:1px solid var(--line);cursor:zoom-in}
figure.shot img.zoom{max-width:none;cursor:zoom-out}
figure.shot{overflow:auto}
ul.fails li{margin:4px 0}
td a,td code.act{white-space:nowrap;word-break:normal}
tr[id],figure[id]{scroll-margin-top:64px}
.hint{color:var(--muted);font-size:13px}
</style>
</head>
<body class="no-js">
<header>
  <h1>${T('report.title')}</h1>
  <div class="meta">${esc(s.name)} · ${T('report.generatedAt')} ${esc(new Date().toISOString())} · ${esc(s.browserVersion)}</div>
</header>
<nav class="tabs" role="tablist">
${tabs.map(([id, label]) => `  <a href="#${id}" data-tab="${id}" role="tab">${esc(label)}</a>`).join('\n')}
</nav>
<main>
<section class="tab" id="summary">
  <div class="overall ${overall}">${T('report.result')}：${T(sum.ok ? 'report.overallPass' : 'report.overallFail')}</div>
  <div class="cards">
    <div class="card"><div class="v">${sum.total}</div><div class="k">${T('report.totalSteps')}</div></div>
    <div class="card"><div class="v" style="color:var(--pass)">${sum.passed}</div><div class="k">${T('report.passed')}</div></div>
    <div class="card"><div class="v" style="color:var(--fail)">${sum.failed}</div><div class="k">${T('report.failed')}</div></div>
    <div class="card"><div class="v">${sum.skipped}</div><div class="k">${T('report.skipped')}</div></div>
    <div class="card"><div class="v">${sum.consoleErrors}</div><div class="k">${T('report.consoleErrors')}</div></div>
    <div class="card"><div class="v">${(sum.durationMs / 1000).toFixed(2)}s</div><div class="k">${T('report.duration')}</div></div>
  </div>
  <h2>${T('report.failures')}</h2>
  ${failList}
</section>
<section class="tab" id="steps">
  <table>
    <thead><tr><th>${T('report.col.no')}</th><th>${T('report.col.status')}</th><th>${T('report.col.action')}</th><th>${T('report.col.target')}</th><th>${T('report.col.detail')}</th><th>${T('report.col.time')}</th><th>${T('report.col.shot')}</th></tr></thead>
    <tbody>${stepRows}
    </tbody>
  </table>
</section>
<section class="tab" id="screenshots">
  <p class="hint">${T('report.clickToZoom')}</p>
  ${shots}
</section>
<section class="tab" id="console">
  ${consoleRows}
</section>
<section class="tab" id="env">
  <table><tbody>${envRows}</tbody></table>
  <h2>${T('report.env.pageTimings')}</h2>
  ${timings}
</section>
</main>
<script>
(function(){
  document.body.classList.remove('no-js');
  var tabIds = ${JSON.stringify(tabs.map((x) => x[0]))};
  function show(id, scrollTo){
    if (tabIds.indexOf(id) < 0) id = 'summary';
    document.querySelectorAll('section.tab').forEach(function(s){ s.classList.toggle('active', s.id === id); });
    document.querySelectorAll('nav.tabs a').forEach(function(a){ a.classList.toggle('active', a.dataset.tab === id); a.setAttribute('aria-selected', a.dataset.tab === id); });
    if (scrollTo) { var el = document.getElementById(scrollTo); if (el) el.scrollIntoView({block:'start'}); }
  }
  function fromHash(){
    var h = decodeURIComponent(location.hash.slice(1));
    if (tabIds.indexOf(h) >= 0) return show(h);
    var el = h && document.getElementById(h);
    if (el) { var sec = el.closest('section.tab'); if (sec) return show(sec.id, h); }
    show('summary');
  }
  document.addEventListener('click', function(e){
    var img = e.target.closest('figure.shot img'); if (img) { img.classList.toggle('zoom'); return; }
    var a = e.target.closest('a[data-tab]');
    if (a) { var target = decodeURIComponent((a.getAttribute('href') || '').slice(1)); show(a.dataset.tab, target !== a.dataset.tab ? target : null); }
  });
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
</script>
</body>
</html>
`;
}

export async function writeReport(session, file) {
  const html = await buildReportHtml(session);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, html, 'utf8');
  return file;
}
