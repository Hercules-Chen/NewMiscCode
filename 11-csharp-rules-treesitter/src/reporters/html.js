// Self-contained HTML report (zh-TW / en toggle, group by rule or file, code snippet with red mark).
import { RULES_META } from '../i18n.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toHtml(result, { lang = 'zh-TW' } = {}) {
  const data = {
    lang, rules: RULES_META, summary: result.summary, versions: result.versions, tool: result.tool,
    targets: result.targets, generated: new Date().toISOString(),
    findings: result.findings.map(f => ({ ruleId: f.ruleId, severity: f.severity, file: f.file, line: f.line, column: f.column, endLine: f.endLine, endColumn: f.endColumn, message: f.message, suggestion: f.suggestion || null, context: f.context || null })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-Hant-TW'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>csrules report</title>
<style>
:root{--bg:#f6f7f9;--fg:#1d2330;--muted:#5d6675;--card:#fff;--line:#dfe3ea;--accent:#2457c5;--codebg:#f3f4f7;--hl:#ffe9e9;--red:#d1242f;--warn:#9a6700;--note:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ef;--muted:#9aa3b2;--card:#1d2128;--line:#323844;--accent:#7aa2ff;--codebg:#20242c;--hl:#4a1f24;--red:#ff6b6b;--warn:#f0c75e;--note:#79b8ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Microsoft JhengHei","PingFang TC","Noto Sans CJK TC","Segoe UI",sans-serif}
header,main{max-width:1100px;margin:auto;padding:16px}
h1{font-size:22px;margin:0 0 4px}
.meta{color:var(--muted);font-size:13px;word-break:break-all}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
button{font:inherit;padding:5px 12px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer}
button.on{border-color:var(--accent);box-shadow:inset 0 -3px 0 var(--accent);font-weight:bold}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.card b{display:block;font-size:24px}
.card.error b{color:var(--red)}.card.warning b{color:var(--warn)}.card.note b{color:var(--note)}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);margin:12px 0}
th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left}
th{white-space:nowrap}
h2{font-size:18px;margin:22px 0 8px;word-break:break-all}
.f{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--red);border-radius:8px;margin:10px 0;padding:8px 12px}
.f.warning{border-left-color:var(--warn)}.f.note{border-left-color:var(--note)}
.loc{font-family:Consolas,"Cascadia Mono",monospace;font-size:13px;word-break:break-all}
.badge{display:inline-block;padding:0 7px;border-radius:10px;font-size:12px;color:#fff;background:var(--red);margin-right:6px}
.badge.warning{background:#9a6700}.badge.note{background:#0969da}
pre{background:var(--codebg);border:1px solid var(--line);border-radius:6px;padding:6px 0;overflow-x:auto;margin:6px 0;font:13px/1.5 Consolas,"Cascadia Mono",monospace}
pre .ln{display:block;padding:0 10px;white-space:pre}
pre .ln i{display:inline-block;width:3.5em;color:var(--muted);font-style:normal;user-select:none}
pre .ln.hit{background:var(--hl);box-shadow:inset 3px 0 0 var(--red)}
mark.err{background:transparent;color:inherit;text-decoration:underline wavy var(--red);text-decoration-thickness:2px;outline:2px solid var(--red);outline-offset:1px;border-radius:2px}
.msg{overflow-wrap:anywhere}
details{margin-top:4px}summary{cursor:pointer;color:var(--accent)}
.empty{padding:24px;text-align:center;color:var(--muted)}
</style>
</head>
<body>
<header>
<h1 id="title">csrules</h1>
<div class="meta" id="meta"></div>
<div class="bar">
  <span id="langLabel"></span>
  <button type="button" data-lang="zh-TW" data-testid="lang-zh">繁體中文</button>
  <button type="button" data-lang="en" data-testid="lang-en">English</button>
  <span id="groupLabel" style="margin-left:12px"></span>
  <button type="button" data-group="rule" data-testid="group-rule"></button>
  <button type="button" data-group="file" data-testid="group-file"></button>
</div>
<div class="cards" id="cards"></div>
<table id="ruleTable"></table>
</header>
<main id="list"></main>
<noscript>${esc('This report needs JavaScript.')}</noscript>
<script type="application/json" id="data">${json}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('data').textContent);
  var T = {
    'zh-TW': { title: 'C# 程式規則檢查報告', lang: '語言：', group: '分組：', byRule: '依規則', byFile: '依檔案', total: '總數', error: '錯誤', warning: '警告', note: '提示', files: '掃描檔案', suppressed: '已抑制', allowed: '允許清單略過', rule: '規則', desc: '說明', count: '數量', none: '沒有發現問題', suggestion: '建議改寫', generated: '產生時間', targets: '掃描目標', sev: { error: '錯誤', warning: '警告', note: '提示' } },
    en: { title: 'C# code rule report', lang: 'Language:', group: 'Group by:', byRule: 'Rule', byFile: 'File', total: 'Total', error: 'Errors', warning: 'Warnings', note: 'Notes', files: 'Files scanned', suppressed: 'Suppressed', allowed: 'Allowlisted', rule: 'Rule', desc: 'Description', count: 'Count', none: 'No findings', suggestion: 'Suggested rewrite', generated: 'Generated', targets: 'Targets', sev: { error: 'Error', warning: 'Warning', note: 'Note' } }
  };
  var lang = D.lang in T ? D.lang : 'zh-TW', group = 'rule';
  try { var h = new URLSearchParams(location.hash.slice(1)); if (h.get('lang') in T) lang = h.get('lang'); if (h.get('group') === 'file') group = 'file'; } catch (e) {}
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function snippet(f) {
    if (!f.context) return '';
    var html = '';
    f.context.lines.forEach(function (text, i) {
      var n = f.context.start + i, body;
      if (n === f.line) {
        var s = f.column - 1, e = f.endLine === f.line ? Math.max(f.endColumn - 1, s + 1) : text.length;
        body = esc(text.slice(0, s)) + '<mark class="err">' + esc(text.slice(s, e)) + '</mark>' + esc(text.slice(e));
      } else body = esc(text);
      html += '<span class="ln' + (n === f.line ? ' hit' : '') + '"><i>' + n + '</i>' + body + '</span>';
    });
    return '<pre>' + html + '</pre>';
  }
  function item(f, t) {
    return '<div class="f ' + f.severity + '" data-testid="finding" data-rule="' + f.ruleId + '">' +
      '<div class="loc"><span class="badge ' + f.severity + '">' + f.ruleId + ' · ' + t.sev[f.severity] + '</span>' + esc(f.file) + ':' + f.line + ':' + f.column + '</div>' +
      '<div class="msg">' + esc(f.message[lang] || f.message.en) + '</div>' + snippet(f) +
      (f.suggestion ? '<details><summary>' + t.suggestion + '</summary><pre><span class="ln">' + esc(f.suggestion).split('\\n').join('</span><span class="ln">') + '</span></pre></details>' : '') + '</div>';
  }
  function render() {
    var t = T[lang], s = D.summary;
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant-TW';
    document.title = t.title;
    document.getElementById('title').textContent = t.title;
    document.getElementById('meta').textContent = t.generated + ': ' + D.generated + ' · ' + t.targets + ': ' + D.targets.join(', ') + ' · ' + D.tool.name + ' ' + D.tool.version + ' · web-tree-sitter ' + D.versions['web-tree-sitter'] + ' · tree-sitter-c-sharp ' + D.versions['tree-sitter-c-sharp'];
    document.getElementById('langLabel').textContent = t.lang;
    document.getElementById('groupLabel').textContent = t.group;
    document.querySelector('[data-group=rule]').textContent = t.byRule;
    document.querySelector('[data-group=file]').textContent = t.byFile;
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('on', b.dataset.lang === lang); });
    document.querySelectorAll('[data-group]').forEach(function (b) { b.classList.toggle('on', b.dataset.group === group); });
    var cards = [['total', s.total], ['error', s.error], ['warning', s.warning], ['note', s.note], ['files', s.files], ['suppressed', s.suppressed], ['allowed', s.allowed]];
    document.getElementById('cards').innerHTML = cards.map(function (c) { return '<div class="card ' + c[0] + '"><span>' + t[c[0]] + '</span><b data-testid="count-' + c[0] + '">' + c[1] + '</b></div>'; }).join('');
    document.getElementById('ruleTable').innerHTML = '<tr><th>' + t.rule + '</th><th>' + t.desc + '</th><th>' + t.count + '</th></tr>' + Object.keys(D.rules).map(function (id) {
      return '<tr><td><a href="#r-' + id + '">' + id + '</a></td><td>' + esc(D.rules[id][lang]) + '</td><td data-testid="rule-count-' + id + '">' + (s.byRule[id] || 0) + '</td></tr>';
    }).join('');
    var groups = {}, order = [];
    D.findings.forEach(function (f) { var k = group === 'rule' ? f.ruleId : f.file; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(f); });
    if (group === 'rule') order.sort();
    var list = document.getElementById('list');
    if (!D.findings.length) { list.innerHTML = '<div class="empty" data-testid="no-findings">' + t.none + '</div>'; return; }
    list.innerHTML = order.map(function (k) {
      var head = group === 'rule' ? k + ' · ' + esc(D.rules[k][lang]) : esc(k);
      return '<section' + (group === 'rule' ? ' id="r-' + k + '"' : '') + ' data-testid="group"><h2>' + head + ' (' + groups[k].length + ')</h2>' + groups[k].map(function (f) { return item(f, t); }).join('') + '</section>';
    }).join('');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.lang) lang = b.dataset.lang;
    if (b.dataset.group) group = b.dataset.group;
    render();
  });
  render();
})();
</script>
</body>
</html>
`;
}
