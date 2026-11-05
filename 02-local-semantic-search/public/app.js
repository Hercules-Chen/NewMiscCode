// Search UI (plain JS, no build step; debuggable in Chrome DevTools -> Sources -> app.js).
'use strict';

const I18N = {
  'zh-TW': {
    title: '本機語意搜尋', verbose: '詳細/除錯', placeholder: '輸入關鍵字或一句話，例如：欄位加密連線失敗',
    mode_hybrid: '混合 (RRF)', mode_keyword: '關鍵字 (BM25)', mode_semantic: '語意 (向量)', search: '搜尋',
    debug_title: '除錯資訊', debug_link: '開啟 /api/debug（設定、統計、最近記錄）',
    searching: '搜尋中…', noResults: '沒有結果', results: '{n} 筆結果，耗時 {ms} ms（向量化 {emb} ms）',
    error: '錯誤：{msg}', matchedBy: '命中', keyword: '關鍵字', semantic: '語意', line: '行',
    footer: '索引：{files} 個檔案 / {chunks} 個區塊 · 嵌入模型：{emb} · 最後索引：{at}', langBtn: 'EN',
  },
  en: {
    title: 'Local Semantic Search', verbose: 'Verbose/debug', placeholder: 'Type keywords or a sentence, e.g. column encryption connection error',
    mode_hybrid: 'Hybrid (RRF)', mode_keyword: 'Keyword (BM25)', mode_semantic: 'Semantic (vector)', search: 'Search',
    debug_title: 'Debug info', debug_link: 'Open /api/debug (config, stats, recent log entries)',
    searching: 'Searching…', noResults: 'No results', results: '{n} results in {ms} ms (embedding {emb} ms)',
    error: 'Error: {msg}', matchedBy: 'matched', keyword: 'keyword', semantic: 'semantic', line: 'line',
    footer: 'Index: {files} files / {chunks} chunks · embedder: {emb} · last indexed: {at}', langBtn: '中文',
  },
};

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};
const params = new URLSearchParams(location.search);
let lang = params.get('lang') || store.get('lss.lang', (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-TW' : 'en');
if (!I18N[lang]) lang = 'zh-TW';
let lastResponse = null;
let lastStats = null;

function t(key, vars = {}) {
  const s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

function applyI18n() {
  document.documentElement.lang = lang === 'zh-TW' ? 'zh-Hant' : 'en';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $('lang').textContent = t('langBtn');
  if (lastResponse) render(lastResponse);
  renderFooter();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render(r) {
  const ol = $('results');
  ol.innerHTML = '';
  $('status').className = 'status';
  $('status').textContent = r.results.length ? t('results', { n: r.results.length, ms: r.debug.totalMs, emb: r.debug.embedMs }) : t('noResults');
  for (const x of r.results) {
    const s = x.scores;
    const li = document.createElement('li');
    li.className = 'result';
    li.dataset.path = x.path;
    li.innerHTML = `
      <div class="head"><span class="rank">#${x.rank}</span><span class="ttl">${esc(x.heading || x.title)}</span></div>
      <div class="path">${esc(x.path)} · ${t('line')} ${x.line}</div>
      <div class="snip">${x.snippet}</div>
      <div class="scores">
        <span class="badge rrf" title="Reciprocal Rank Fusion">RRF ${s.rrf.toFixed(4)}</span>
        ${s.keywordRank ? `<span class="badge kw" title="FTS5 bm25 (lower is better)">${t('keyword')} #${s.keywordRank} · bm25 ${s.bm25}</span>` : ''}
        ${s.semanticRank ? `<span class="badge sem" title="cosine similarity">${t('semantic')} #${s.semanticRank} · cos ${s.cosine}</span>` : ''}
        <span class="badge">${t('matchedBy')}: ${x.matchedBy.map((m) => t(m)).join(' + ')}</span>
      </div>
      <pre class="raw">${esc(JSON.stringify({ chunkId: x.chunkId, scores: s }, null, 0))}</pre>`;
    ol.appendChild(li);
  }
  if ($('verbose').checked) $('debugOut').textContent = JSON.stringify(r.debug, null, 2);
}

function renderFooter() {
  if (!lastStats) return;
  $('footer').textContent = t('footer', { files: lastStats.files, chunks: lastStats.chunks, emb: lastStats.embedder, at: lastStats.lastIndexedAt });
}

async function doSearch(ev) {
  if (ev) ev.preventDefault();
  const q = $('q').value.trim();
  if (!q) return;
  const qs = new URLSearchParams({ q, mode: $('mode').value, k: $('k').value });
  history.replaceState(null, '', '?' + qs.toString() + (lang ? `&lang=${lang}` : '') + ($('verbose').checked ? '&debug=1' : ''));
  $('status').className = 'status';
  $('status').textContent = t('searching');
  try {
    const res = await fetch('/api/search?' + qs.toString());
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    lastResponse = body;
    if ($('verbose').checked) console.debug('[lss] search response', body);
    render(body);
  } catch (err) {
    console.error('[lss] search failed', err);
    $('status').className = 'status error';
    $('status').textContent = t('error', { msg: err.message });
  }
}

async function loadStats() {
  try { const r = await fetch('/api/stats'); if (r.ok) { lastStats = await r.json(); renderFooter(); } } catch (err) { console.warn('[lss] stats', err); }
}

function setVerbose(on) {
  document.body.classList.toggle('verbose', on);
  $('debug').hidden = !on;
  if (on && lastResponse) $('debugOut').textContent = JSON.stringify(lastResponse.debug, null, 2);
}

$('form').addEventListener('submit', doSearch);
$('lang').addEventListener('click', () => { lang = lang === 'zh-TW' ? 'en' : 'zh-TW'; store.set('lss.lang', lang); applyI18n(); });
$('verbose').addEventListener('change', (e) => setVerbose(e.target.checked));

// Restore state from URL (?q=...&mode=...&k=...&debug=1&lang=en)
if (params.get('mode')) $('mode').value = params.get('mode');
if (params.get('k')) $('k').value = params.get('k');
if (params.get('debug') === '1') { $('verbose').checked = true; setVerbose(true); }
applyI18n();
loadStats();
if (params.get('q')) { $('q').value = params.get('q'); doSearch(); }
// Expose for DevTools console experiments: window.lss.search('...')
window.lss = { search: (q) => { $('q').value = q; return doSearch(); }, I18N, get last() { return lastResponse; } };
