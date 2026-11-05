// 自包含 HTML 模板（內嵌 CSS/JS，無 CDN）。 Self-contained page template.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const CSS = `
:root { --bg:#fafafa; --fg:#1f2328; --muted:#59636e; --card:#ffffff; --line:#d1d9e0; --accent:#0969da; --ok:#1a7f37; --warn:#9a6700; --bad:#cf222e; --imp:#8250df; --code:#eff2f5; color-scheme:light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --card:#151b23; --line:#3d444d; --accent:#4493f8; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --imp:#ab7df8; --code:#1f2630; color-scheme:dark; } }
:root[data-theme="dark"] { --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --card:#151b23; --line:#3d444d; --accent:#4493f8; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --imp:#ab7df8; --code:#1f2630; color-scheme:dark; }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.7 "Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif; overflow-wrap:anywhere; }
header { padding:24px 16px 8px; max-width:1040px; margin:auto; }
header h1 { margin:0 0 4px; font-size:26px; }
h2 { font-size:21px; margin:8px 0 12px; }
h3 { font-size:17px; margin:22px 0 8px; }
h2, h3, h4 { scroll-margin-top:56px; }
.sub { color:var(--muted); margin:0; }
nav#nav { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); z-index:5; }
nav#nav .in { max-width:1040px; margin:auto; padding:0 16px; display:flex; gap:2px; overflow-x:auto; align-items:center; }
nav#nav a { padding:10px 10px; color:var(--muted); text-decoration:none; white-space:nowrap; border-bottom:2px solid transparent; font-size:14px; }
nav#nav a.on { color:var(--fg); border-color:var(--accent); font-weight:600; }
nav#nav a.all { margin-left:auto; }
nav#nav button { font:inherit; font-size:13px; color:var(--muted); background:none; border:1px solid var(--line); border-radius:6px; padding:2px 8px; cursor:pointer; white-space:nowrap; }
main { max-width:1040px; margin:auto; padding:16px; }
section.tab { display:none; } section.tab.on, body.all section.tab, body.no-js section.tab { display:block; }
body.all section.tab + section.tab { border-top:1px dashed var(--line); margin-top:24px; padding-top:8px; }
.toc { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:6px 14px; margin:8px 0 12px; font-size:14px; }
.toc a { margin-right:14px; white-space:nowrap; display:inline-block; }
a.anchor { color:var(--muted); text-decoration:none; font-weight:400; opacity:.5; }
a.anchor:hover { opacity:1; }
.card, .admonition { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 16px; margin:12px 0; }
.admonition { border-left:4px solid var(--accent); }
.admonition.tip { border-left-color:var(--ok); } .admonition.important { border-left-color:var(--imp); }
.admonition.warning { border-left-color:var(--warn); } .admonition.caution { border-left-color:var(--bad); }
.admonition-title { font-weight:700; margin:4px 0; color:var(--accent); }
.tip .admonition-title { color:var(--ok); } .important .admonition-title { color:var(--imp); }
.warning .admonition-title { color:var(--warn); } .caution .admonition-title { color:var(--bad); }
.admonition > :last-child { margin-bottom:4px; }
blockquote { margin:12px 0; padding:2px 14px; border-left:4px solid var(--line); color:var(--muted); }
.table-wrap { max-width:100%; overflow-x:auto; margin:8px 0; }
table { border-collapse:collapse; width:100%; font-size:14px; }
th, td { border:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
th { background:var(--code); }
code { font-family:Consolas,"Cascadia Mono",monospace; font-size:13px; background:var(--code); padding:1px 4px; border-radius:4px; }
pre { font-family:Consolas,"Cascadia Mono",monospace; font-size:13px; background:var(--code); border:1px solid var(--line); border-radius:6px; padding:10px; overflow-x:auto; overflow-wrap:normal; }
pre code { background:none; padding:0; }
img { max-width:100%; height:auto; border:1px solid var(--line); border-radius:6px; }
a { color:var(--accent); }
li.task-item { list-style:none; margin-left:-1.2em; }
li.task-item input { margin:0 6px 0 0; vertical-align:middle; }
hr { border:0; border-top:1px solid var(--line); }
footer { max-width:1040px; margin:auto; padding:16px; color:var(--muted); font-size:13px; }
@media (max-width: 640px) { header h1 { font-size:22px; } main { padding:12px 16px; } }
@media print {
  nav#nav, a.anchor, .toc { display:none !important; }
  section.tab { display:block !important; break-before:page; }
  section.tab:first-of-type { break-before:auto; }
  body { background:#fff; color:#000; }
  pre, .table-wrap { overflow:visible; white-space:pre-wrap; }
}
`;

// 分頁腳本：#分頁id → 顯示該分頁；#子錨點 → 顯示所在分頁並捲動到該元素；#all → 全部顯示。
export const JS = `
(function () {
  var root = document.documentElement, body = document.body;
  body.classList.remove('no-js');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('section.tab'));
  var links = Array.prototype.slice.call(document.querySelectorAll('#nav a[href^="#"]'));
  function show() {
    var raw = (location.hash || '').slice(1), id;
    try { id = decodeURIComponent(raw); } catch (e) { id = raw; }
    var all = id === 'all', target = null, tabId = tabs.length ? tabs[0].id : '';
    if (!all && id) {
      var el = document.getElementById(id);
      if (el) {
        var sec = el.closest('section.tab');
        if (sec) { tabId = sec.id; if (sec !== el) target = el; }
      }
    }
    body.classList.toggle('all', all);
    tabs.forEach(function (s) { s.classList.toggle('on', !all && s.id === tabId); });
    links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + (all ? 'all' : tabId)); });
    if (target) target.scrollIntoView();
    else if (!all && id && document.getElementById(id) && document.getElementById(id).classList.contains('tab')) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show);
  show();
  var modes = ['auto', 'light', 'dark'], btn = document.getElementById('theme');
  function applyTheme(m) {
    if (m === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
    if (btn) btn.setAttribute('data-mode', m);
  }
  var saved = 'auto';
  try { saved = localStorage.getItem('md2tabs-theme') || 'auto'; } catch (e) {}
  applyTheme(modes.indexOf(saved) >= 0 ? saved : 'auto');
  if (btn) btn.addEventListener('click', function () {
    var next = modes[(modes.indexOf(btn.getAttribute('data-mode')) + 1) % modes.length];
    applyTheme(next);
    try { localStorage.setItem('md2tabs-theme', next); } catch (e) {}
  });
})();
`;

export function renderPage(doc, { version }) {
  const s = doc.strings;
  const nav = doc.tabs.map(t => `<a href="#${esc(t.id)}">${esc(t.title)}</a>`).join('\n');
  const sections = doc.tabs.map(t => {
    const toc = t.subs.length >= 2 ? `<div class="toc" aria-label="${esc(s.contents)}">${t.subs.map(x => `<a href="#${esc(x.id)}">${esc(x.title)}</a>`).join(' ')}</div>\n` : '';
    // 把目錄插在 h2 之後
    const html = toc ? t.html.replace(/(<\/h2>\n?)/, `$1${toc}`) : t.html;
    return `<section class="tab" id="${esc(t.id)}">\n${html}</section>`;
  }).join('\n');
  const footer = doc.footer ? md(doc.footer) : '';
  return `<!DOCTYPE html>
<html lang="${esc(doc.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="md2tabs ${esc(version)}">
<title>${esc(doc.title)}</title>
<style>${CSS}</style>
</head>
<body class="no-js">
<header>
<h1>${esc(doc.title)}</h1>
${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>\n` : ''}${doc.preface}</header>
<nav id="nav" aria-label="${esc(s.tabs)}"><div class="in">
${nav}
<a class="all" href="#all">${esc(s.showAll)}</a>
<button type="button" id="theme" title="${esc(s.themeTitle)}">${esc(s.theme)}</button>
</div></nav>
<main>
${sections}
</main>
<footer>${footer}${footer ? ' · ' : ''}${esc(s.generated)} ${esc(version)}</footer>
<script>${JS}</script>
</body>
</html>
`;
  function md(x) { return esc(x); }
}
