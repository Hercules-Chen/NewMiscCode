// 報告輸出：console / json / md / html（自含、可切換語言）。
// Report output: console / json / md / self-contained html with zh-TW/en toggle.
import { STR, t } from '../i18n.js';
import { VERSION } from '../env.js';

export function buildReport({ kind, findings, exchanges, inputs, debug, lang }) {
  const summary = { BREAKING: 0, NON_BREAKING: 0, INFO: 0 };
  for (const f of findings) summary[f.severity]++;
  return { tool: 'apiguard', version: VERSION, kind, lang, generatedAt: new Date().toISOString(), inputs, summary, findings, ...(exchanges ? { exchanges } : {}), debug: debug || {} };
}

const COLORS = { BREAKING: '\x1b[31m', NON_BREAKING: '\x1b[32m', INFO: '\x1b[36m', OK: '\x1b[32m' };

export function renderConsole(report, lang, { color = true } = {}) {
  const c = (sev, s) => (color ? `${COLORS[sev] || ''}${s}\x1b[0m` : s);
  const lines = [];
  lines.push(`== ${t(lang, report.kind === 'diff' ? 'title_diff' : 'title_replay')} ==`);
  for (const [k, v] of Object.entries(report.inputs || {})) lines.push(`  ${k}: ${v}`);
  for (const f of report.findings) {
    lines.push(`${c(f.severity, `[${t(lang, f.severity)}]`)} ${f.rule}  ${f.location}`);
    lines.push(`    ${f.message[lang] || f.message.en}`);
  }
  const s = report.summary;
  lines.push(`-- ${t(lang, 'BREAKING')}: ${s.BREAKING}  ${t(lang, 'NON_BREAKING')}: ${s.NON_BREAKING}  ${t(lang, 'INFO')}: ${s.INFO}`);
  lines.push(s.BREAKING ? c('BREAKING', t(lang, 'verdict_fail')) : c('OK', t(lang, 'verdict_ok')));
  return lines.join('\n');
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

const mdEsc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(report, lang) {
  const s = report.summary;
  const out = [];
  out.push(`# ${t(lang, report.kind === 'diff' ? 'title_diff' : 'title_replay')}`, '');
  out.push(`- ${t(lang, 'generated')}: ${report.generatedAt}`);
  for (const [k, v] of Object.entries(report.inputs || {})) out.push(`- ${k}: \`${v}\``);
  out.push('', `**${s.BREAKING ? t(lang, 'verdict_fail') : t(lang, 'verdict_ok')}**`, '');
  out.push(`| ${t(lang, 'BREAKING')} | ${t(lang, 'NON_BREAKING')} | ${t(lang, 'INFO')} |`, '|---|---|---|', `| ${s.BREAKING} | ${s.NON_BREAKING} | ${s.INFO} |`, '');
  out.push(`## ${t(lang, 'changes')}`, '');
  if (!report.findings.length) out.push(t(lang, 'none'));
  else {
    out.push(`| ${t(lang, 'severity')} | ${t(lang, 'rule')} | ${t(lang, 'location')} | ${t(lang, 'message')} |`, '|---|---|---|---|');
    for (const f of report.findings) out.push(`| ${t(lang, f.severity)} | \`${f.rule}\` | \`${mdEsc(f.location)}\` | ${mdEsc(f.message[lang] || f.message.en)} |`);
  }
  return out.join('\n') + '\n';
}

/** 自含 HTML：資料以 JSON 內嵌，前端 JS 依語言渲染。 */
export function renderHtml(report, lang) {
  const data = JSON.stringify(report).replace(/</g, '\\u003c');
  const strings = JSON.stringify(STR).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>apiguard report</title>
<style>
:root{--bg:#f7f8fa;--fg:#1d2330;--muted:#5b6475;--card:#fff;--line:#dfe3ea;--br:#c62828;--nb:#2e7d32;--info:#1565c0;--ok:#2e7d32}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e6e9ef;--muted:#9aa3b2;--card:#1d2129;--line:#2f3542;--br:#ef5350;--nb:#66bb6a;--info:#64b5f6;--ok:#66bb6a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif}
header{padding:16px;border-bottom:1px solid var(--line);background:var(--card);display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
h1{font-size:1.2rem;margin:0}
main{padding:16px;max-width:1200px;margin:0 auto}
nav.tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
nav.tabs button,#lang-toggle,.filters button{border:1px solid var(--line);background:var(--card);color:var(--fg);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit}
nav.tabs button[aria-selected=true],.filters button.on{background:var(--fg);color:var(--bg)}
section[role=tabpanel]{display:none}section[role=tabpanel].active{display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.card b{display:block;font-size:1.8rem}
.sev-BREAKING{color:var(--br)}.sev-NON_BREAKING{color:var(--nb)}.sev-INFO{color:var(--info)}.sev-OK{color:var(--ok)}
.verdict{padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);font-weight:600}
.scroll{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;background:var(--card)}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;word-break:break-word}
code,pre{font-family:Consolas,"Cascadia Mono",monospace;font-size:.85em}
pre{white-space:pre-wrap;word-break:break-all;background:var(--card);border:1px solid var(--line);padding:8px;border-radius:6px;max-height:480px;overflow:auto}
.muted{color:var(--muted)}
td ul{margin:0;padding-left:18px}
.filters{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}
dl{display:grid;grid-template-columns:minmax(80px,max-content) 1fr;gap:4px 12px}dd{margin:0;word-break:break-all}
@media (max-width:600px){table thead{display:none}table,tbody,tr,td{display:block;width:100%}tr{border-bottom:2px solid var(--line)}td{border:none;border-top:1px solid var(--line)}}
</style>
</head>
<body>
<header><h1 id="title"></h1><button id="lang-toggle" type="button"></button></header>
<main>
<nav class="tabs" role="tablist" id="tabs"></nav>
<section role="tabpanel" id="tab-summary"></section>
<section role="tabpanel" id="tab-changes"></section>
<section role="tabpanel" id="tab-exchanges"></section>
<section role="tabpanel" id="tab-raw"></section>
</main>
<script type="application/json" id="report-data">${data}</script>
<script type="application/json" id="i18n-data">${strings}</script>
<script>
(function(){
var R=JSON.parse(document.getElementById('report-data').textContent);
var S=JSON.parse(document.getElementById('i18n-data').textContent);
var lang=${JSON.stringify(lang)};var tab='summary';var filter='ALL';
try{var q=new URLSearchParams(location.search).get('lang');if(q==='en'||q==='zh-TW')lang=q;}catch(e){}
function T(k){return (S[lang]&&S[lang][k])||k}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function msg(f){return f.message?(f.message[lang]||f.message.en):''}
function tabs(){var list=['summary','changes'];if(R.exchanges)list.push('exchanges');list.push('raw');
 document.getElementById('tabs').innerHTML=list.map(function(k){return '<button role="tab" type="button" data-tab="'+k+'" aria-selected="'+(k===tab)+'">'+esc(T(k))+'</button>'}).join('');
 document.querySelectorAll('section[role=tabpanel]').forEach(function(s){s.classList.toggle('active',s.id==='tab-'+tab)});}
function summary(){var s=R.summary;var html='<div class="verdict '+(s.BREAKING?'sev-BREAKING':'sev-OK')+'" id="verdict">'+esc(s.BREAKING?T('verdict_fail'):T('verdict_ok'))+'</div>';
 html+='<div class="cards">'+['BREAKING','NON_BREAKING','INFO'].map(function(k){return '<div class="card"><span class="sev-'+k+'">'+esc(T(k))+'</span><b id="count-'+k+'">'+s[k]+'</b></div>'}).join('')+'</div>';
 html+='<dl><dt>'+esc(T('generated'))+'</dt><dd>'+esc(R.generatedAt)+'</dd>';
 Object.keys(R.inputs||{}).forEach(function(k){html+='<dt>'+esc(k)+'</dt><dd><code>'+esc(R.inputs[k])+'</code></dd>'});
 html+='<dt>'+esc(T('exit_code'))+'</dt><dd>'+(s.BREAKING?1:0)+'</dd></dl>';
 document.getElementById('tab-summary').innerHTML=html;}
function changes(){var fs=R.findings.filter(function(f){return filter==='ALL'||f.severity===filter});
 var html='<div class="filters">'+['ALL','BREAKING','NON_BREAKING','INFO'].map(function(k){return '<button type="button" data-filter="'+k+'" class="'+(k===filter?'on':'')+'">'+esc(k==='ALL'?T('all'):T(k))+' ('+(k==='ALL'?R.findings.length:R.summary[k])+')</button>'}).join('')+'</div>';
 if(!fs.length)html+='<p class="muted">'+esc(T('none'))+'</p>';else{
 html+='<div class="scroll"><table id="findings"><thead><tr><th>'+esc(T('severity'))+'</th><th>'+esc(T('rule'))+'</th><th>'+esc(T('location'))+'</th><th>'+esc(T('message'))+'</th></tr></thead><tbody>';
 fs.forEach(function(f){html+='<tr data-sev="'+f.severity+'"><td class="sev-'+f.severity+'">'+esc(T(f.severity))+'</td><td><code>'+esc(f.rule)+'</code></td><td><code>'+esc(f.location)+'</code>'+(f.field?'<br><span class="muted">'+esc(f.field)+'</span>':'')+'</td><td>'+esc(msg(f))+'</td></tr>'});
 html+='</tbody></table></div>';}
 document.getElementById('tab-changes').innerHTML=html;}
function exchanges(){if(!R.exchanges)return;var html='<div class="scroll"><table id="exchange-table"><thead><tr><th>'+esc(T('severity'))+'</th><th>'+esc(T('method'))+'</th><th>'+esc(T('url'))+'</th><th>'+esc(T('status'))+'</th><th>'+esc(T('diffs'))+'</th></tr></thead><tbody>';
 R.exchanges.forEach(function(x){html+='<tr><td class="sev-'+x.severity+'">'+esc(T(x.severity))+'</td><td>'+esc(x.method)+'</td><td><code>'+esc(x.url)+'</code></td><td>'+esc(x.oldStatus)+' &rarr; '+esc(x.newStatus)+'</td><td>'+(x.diffs.length?'<ul>'+x.diffs.map(function(d){return '<li class="sev-'+d.severity+'">'+esc(msg(d))+'</li>'}).join('')+'</ul>':'-')+'</td></tr>'});
 html+='</tbody></table></div>';document.getElementById('tab-exchanges').innerHTML=html;}
function raw(){document.getElementById('tab-raw').innerHTML='<p class="muted">apiguard '+esc(R.version)+' &middot; kind='+esc(R.kind)+'</p><h3>debug</h3><pre>'+esc(JSON.stringify(R.debug,null,2))+'</pre><h3>report JSON</h3><pre id="raw-json">'+esc(JSON.stringify(R,null,2))+'</pre>';}
function render(){document.documentElement.lang=lang;document.title='apiguard - '+T(R.kind==='diff'?'title_diff':'title_replay');
 document.getElementById('title').textContent=T(R.kind==='diff'?'title_diff':'title_replay');
 document.getElementById('lang-toggle').textContent=T('lang');tabs();summary();changes();exchanges();raw();}
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
 if(b.id==='lang-toggle'){lang=lang==='en'?'zh-TW':'en';render();}
 else if(b.dataset.tab){tab=b.dataset.tab;tabs();}
 else if(b.dataset.filter){filter=b.dataset.filter;changes();}});
render();
})();
</script>
</body>
</html>
`;
}

export function renderAs(format, report, lang) {
  if (format === 'json') return renderJson(report);
  if (format === 'md' || format === 'markdown') return renderMarkdown(report, lang);
  if (format === 'html') return renderHtml(report, lang);
  return renderConsole(report, lang, { color: Boolean(process.stdout.isTTY && !process.env.NO_COLOR) });
}
