// OTel trace viewer front-end (no framework, no build step).
// Routes: #/            trace list + dependency graph
//         #/trace/<id>  waterfall + span detail (+ ?span=<spanId>)
(function () {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
  const state = { lang: LS.get('otv.lang') || 'zh-TW', theme: LS.get('otv.theme') || '', trace: null, selected: '', collapsed: new Set(), logScope: 'span', timer: null };
  if (!window.I18N[state.lang]) state.lang = 'zh-TW';

  function t(key, vars) {
    let s = (window.I18N[state.lang] || {})[key] ?? window.I18N['zh-TW'][key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtDur(us) {
    if (us < 1000) return `${Math.round(us)} µs`;
    if (us < 1e6) return `${(us / 1000).toFixed(us < 1e4 ? 2 : 1)} ms`;
    return `${(us / 1e6).toFixed(2)} s`;
  }
  function fmtTime(us) {
    const d = new Date(us / 1000);
    return d.toLocaleString(state.lang === 'en' ? 'en-US' : 'zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  const PALETTE = ['#2f6fdf', '#21a179', '#e0663f', '#9a5bd6', '#c9a227', '#d14d8f', '#2aa5b8', '#7a8c2e'];
  const colorCache = new Map();
  function svcColor(name) {
    if (!colorCache.has(name)) {
      let h = 0;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      colorCache.set(name, PALETTE[h % PALETTE.length]);
    }
    return colorCache.get(name);
  }

  async function api(path) {
    const r = await fetch(path, { headers: { accept: 'application/json' } });
    if (!r.ok) { const e = new Error(`${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }

  // ---------- i18n / theme ----------
  function applyLang() {
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hant-TW';
    document.title = t('appTitle');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    $('#langBtn').textContent = t('langBtn');
  }
  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme; else delete document.documentElement.dataset.theme;
  }
  $('#langBtn').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'zh-TW' : 'en';
    LS.set('otv.lang', state.lang);
    applyLang();
    routeAll();
  });
  $('#themeBtn').addEventListener('click', () => {
    const dark = state.theme ? state.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = dark ? 'light' : 'dark';
    LS.set('otv.theme', state.theme);
    applyTheme();
  });

  // ---------- list view ----------
  function filterParams() {
    const f = new FormData($('#filters'));
    const p = new URLSearchParams();
    for (const [k, v] of f.entries()) if (v && v !== '0') p.set(k, String(v));
    return p;
  }

  async function loadServices() {
    const sel = $('#fService');
    const cur = sel.value;
    const list = await api('/api/services');
    sel.innerHTML = `<option value="">${esc(t('all'))}</option>` + list.map((s) => `<option value="${esc(s.service)}">${esc(s.service)}</option>`).join('');
    sel.value = cur;
  }

  async function loadStats() {
    const s = await api('/api/stats');
    $('#stats').textContent = t('statsLine', s);
  }

  function showView(name) {
    const wasHidden = $(name === 'list' ? '#listView' : '#traceView').hidden;
    $('#listView').hidden = name !== 'list';
    $('#traceView').hidden = name !== 'trace';
    if (wasHidden) window.scrollTo(0, 0);
  }

  async function renderList() {
    showView('list');
    try {
      await loadServices();
      const params = filterParams();
      const [traces, deps] = await Promise.all([api('/api/traces?' + params), api('/api/dependencies?' + (params.get('sinceMinutes') ? 'sinceMinutes=' + params.get('sinceMinutes') : ''))]);
      const max = Math.max(1, ...traces.map((x) => x.duration_us));
      $('#traceRows').innerHTML = traces.map((tr) => `
        <tr data-trace="${esc(tr.trace_id)}" data-testid="trace-row" tabindex="0" class="${tr.error_count ? 'is-error' : ''}">
          <td class="nowrap small hide-sm">${esc(fmtTime(tr.start_us))}</td>
          <td class="rootcell"><span class="dot" style="background:${svcColor(tr.root_service)}"></span><b>${esc(tr.root_service)}</b> <span class="rname">${esc(tr.root_name)}</span>
            <div class="tid mono small muted">${esc(tr.trace_id.slice(0, 16))}…</div><div class="show-sm small muted">${esc(fmtTime(tr.start_us))}</div></td>
          <td class="durcell"><span class="nowrap">${esc(fmtDur(tr.duration_us))}</span><div class="minibar"><i style="width:${Math.max(2, (tr.duration_us / max) * 100).toFixed(1)}%"></i></div></td>
          <td class="hide-sm">${tr.span_count}</td>
          <td class="hide-sm">${tr.services.map((s) => `<span class="chip" style="--c:${svcColor(s)}">${esc(s)}</span>`).join(' ')}</td>
          <td>${tr.error_count ? `<span class="badge err">${esc(t('error'))} ${tr.error_count}</span>` : `<span class="badge ok">${esc(t('ok'))}</span>`}</td>
        </tr>`).join('');
      $('#traceCount').textContent = t('traceCount', { n: traces.length });
      $('#emptyMsg').hidden = traces.length > 0;
      renderDeps(deps);
    } catch (err) {
      $('#traceCount').textContent = t('loadFailed', { msg: err.message });
    }
  }

  function renderDeps(edges) {
    const box = $('#depGraph');
    if (!edges.length) { box.innerHTML = `<p class="muted">${esc(t('depEmpty'))}</p>`; return; }
    const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))];
    const layer = Object.fromEntries(nodes.map((n) => [n, 0]));
    for (let i = 0; i < nodes.length; i++) for (const e of edges) if (layer[e.target] < layer[e.source] + 1 && e.source !== e.target) layer[e.target] = Math.min(layer[e.source] + 1, nodes.length);
    const layers = {};
    for (const n of nodes) (layers[layer[n]] ||= []).push(n);
    const cols = Object.keys(layers).length;
    const rows = Math.max(...Object.values(layers).map((l) => l.length));
    const W = Math.max(320, cols * 150), H = Math.max(120, rows * 70);
    const pos = {};
    Object.entries(layers).forEach(([l, ns]) => ns.forEach((n, i) => { pos[n] = { x: 70 + Number(l) * ((W - 140) / Math.max(1, cols - 1)), y: (H / (ns.length + 1)) * (i + 1) }; }));
    const lines = edges.map((e) => {
      const a = pos[e.source], b = pos[e.target];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const x1 = a.x + (dx / len) * 46, y1 = a.y + (dy / len) * 20, x2 = b.x - (dx / len) * 50, y2 = b.y - (dy / len) * 22;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 8;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="edge${e.errors ? ' has-err' : ''}" marker-end="url(#arrow)"/>
        <text x="${mx}" y="${my}" class="elabel" text-anchor="middle">${e.calls}${e.errors ? ` <tspan class="eerr">(${e.errors})</tspan>` : ''}</text>`;
    }).join('');
    const circles = nodes.map((n) => `<g class="node"><rect x="${pos[n].x - 46}" y="${pos[n].y - 18}" width="92" height="36" rx="18" style="stroke:${svcColor(n)}"/>
      <text x="${pos[n].x}" y="${pos[n].y + 5}" text-anchor="middle">${esc(n)}</text></g>`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('depGraph'))}">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>
      ${lines}${circles}</svg>`;
  }

  $('#traceRows').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-trace]');
    if (tr) location.hash = `#/trace/${tr.dataset.trace}`;
  });
  $('#traceRows').addEventListener('keydown', (ev) => {
    const tr = ev.target.closest('tr[data-trace]');
    if (tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); location.hash = `#/trace/${tr.dataset.trace}`; }
  });
  let debounce = null;
  $('#filters').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(renderList, 250); });
  $('#filters').addEventListener('submit', (ev) => { ev.preventDefault(); renderList(); });
  $('#refreshBtn').addEventListener('click', () => { state.trace = null; routeAll(); });
  $('#autoRefresh').addEventListener('change', (ev) => {
    clearInterval(state.timer);
    state.timer = ev.target.checked ? setInterval(() => { if (!$('#listView').hidden) renderList(); }, 5000) : null;
  });

  // ---------- trace view ----------
  function buildTree(spans) {
    const byId = new Map(spans.map((s) => [s.span_id, { ...s, children: [] }]));
    const roots = [];
    for (const s of byId.values()) {
      const p = s.parent_span_id && byId.get(s.parent_span_id);
      if (p) p.children.push(s); else roots.push(s);
    }
    const sortRec = (list) => { list.sort((a, b) => a.start_us - b.start_us); list.forEach((c) => sortRec(c.children)); };
    sortRec(roots);
    const flat = [];
    const walk = (n, depth) => { flat.push({ node: n, depth }); n.children.forEach((c) => walk(c, depth + 1)); };
    roots.forEach((r) => walk(r, 0));
    return { byId, flat };
  }

  async function renderTrace(id, spanParam) {
    showView('trace');
    let data;
    try {
      data = state.trace && state.trace.trace_id === id ? state.trace : await api(`/api/traces/${id}`);
    } catch (err) {
      $('#traceTitle').textContent = err.status === 404 ? t('notFound') : t('loadFailed', { msg: err.message });
      $('#traceMeta').innerHTML = '';
      $('#waterfall').innerHTML = '';
      $('#ruler').innerHTML = '';
      $('#detail').innerHTML = '';
      return;
    }
    if (!state.trace || state.trace.trace_id !== id) { state.collapsed.clear(); state.selected = ''; }
    state.trace = data;
    const tree = buildTree(data.spans);
    data._tree = tree;
    const t0 = Math.min(...data.spans.map((s) => s.start_us));
    const t1 = Math.max(...data.spans.map((s) => s.end_us));
    data._t0 = t0; data._total = Math.max(1, t1 - t0);
    const root = tree.flat[0].node;
    const errors = data.spans.filter((s) => s.status_code === 2).length;
    const services = [...new Set(data.spans.map((s) => s.service))];
    $('#traceTitle').innerHTML = `<span class="dot" style="background:${svcColor(root.service)}"></span>${esc(root.service)}: ${esc(root.name)}`;
    $('#traceMeta').innerHTML = `
      <span><b>${esc(t('traceId'))}</b> <code class="mono" data-testid="trace-id">${esc(id)}</code></span>
      <span><b>${esc(t('start'))}</b> ${esc(fmtTime(t0))}</span>
      <span><b>${esc(t('duration'))}</b> ${esc(fmtDur(data._total))}</span>
      <span>${esc(t('spans', { n: data.spans.length }))}</span>
      <span>${services.map((s) => `<span class="chip" style="--c:${svcColor(s)}">${esc(s)}</span>`).join(' ')}</span>
      ${errors ? `<span class="badge err">${esc(t('errors', { n: errors }))}</span>` : `<span class="badge ok">${esc(t('ok'))}</span>`}`;
    const ticks = 4;
    $('#ruler').innerHTML = `<div class="rlabel"></div><div class="rtrack">${Array.from({ length: ticks + 1 }, (_, i) => `<span style="left:${(i / ticks) * 100}%">${esc(fmtDur((data._total * i) / ticks))}</span>`).join('')}</div>`;
    drawWaterfall();
    const sel = spanParam && tree.byId.has(spanParam) ? spanParam : (state.selected && tree.byId.has(state.selected) ? state.selected : root.span_id);
    selectSpan(sel, false);
  }

  function isHidden(node, byId) {
    let p = node.parent_span_id && byId.get(node.parent_span_id);
    while (p) { if (state.collapsed.has(p.span_id)) return true; p = p.parent_span_id && byId.get(p.parent_span_id); }
    return false;
  }

  function drawWaterfall() {
    const data = state.trace;
    const { flat, byId } = data._tree;
    $('#waterfall').innerHTML = flat.filter(({ node }) => !isHidden(node, byId)).map(({ node: s, depth }) => {
      const left = ((s.start_us - data._t0) / data._total) * 100;
      const width = Math.max(0.4, (s.duration_us / data._total) * 100);
      const hasKids = s.children.length > 0;
      const collapsed = state.collapsed.has(s.span_id);
      const err = s.status_code === 2;
      // Duration label placement: after the bar, inside it (wide bars near the right edge) or before it (narrow bars near the right edge).
      const place = left + width <= 70 ? 'after' : (width >= 14 ? 'inside' : 'before');
      const durStyle = place === 'after' ? `left:calc(${(left + width).toFixed(3)}% + 4px)` : place === 'inside' ? `right:${(100 - left - width).toFixed(3)}%` : `right:calc(${(100 - left).toFixed(3)}% + 4px)`;
      return `<div class="wf-row${err ? ' is-error' : ''}${state.selected === s.span_id ? ' selected' : ''}" role="treeitem" tabindex="0" data-span="${s.span_id}" data-testid="waterfall-row" aria-level="${depth + 1}">
        <div class="wf-label" style="padding-left:${Math.min(depth, 12) * 12 + 4}px">
          ${hasKids ? `<button type="button" class="twisty" data-toggle="${s.span_id}" title="${esc(t('toggleChildren'))}" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>` : '<span class="twisty-sp"></span>'}
          <span class="dot" style="background:${svcColor(s.service)}"></span>
          <span class="svc">${esc(s.service)}</span> <span class="sname">${esc(s.name)}</span>${err ? ' <span class="erricon" aria-label="error">!</span>' : ''}
        </div>
        <div class="wf-track"><div class="wf-bar" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${err ? 'var(--err)' : svcColor(s.service)}"></div>
          <span class="wf-dur ${place}" style="${durStyle}">${esc(fmtDur(s.duration_us))}</span>
          ${s.events.map((e) => `<i class="wf-ev" title="${esc(e.name)}" style="left:${(((e.time_us - data._t0) / data._total) * 100).toFixed(3)}%"></i>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  $('#waterfall').addEventListener('click', (ev) => {
    const tg = ev.target.closest('[data-toggle]');
    if (tg) {
      const id = tg.dataset.toggle;
      if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
      drawWaterfall();
      return;
    }
    const row = ev.target.closest('.wf-row');
    if (row) selectSpan(row.dataset.span, true);
  });
  $('#waterfall').addEventListener('keydown', (ev) => {
    const row = ev.target.closest('.wf-row');
    if (!row) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectSpan(row.dataset.span, true); }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const sib = ev.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (sib) { sib.focus(); selectSpan(sib.dataset.span, true); }
    }
  });
  $('#expandAll').addEventListener('click', () => { state.collapsed.clear(); drawWaterfall(); });
  $('#collapseAll').addEventListener('click', () => {
    for (const { node } of state.trace._tree.flat) if (node.children.length && node.parent_span_id) state.collapsed.add(node.span_id);
    drawWaterfall();
  });

  function kv(obj) {
    const entries = Object.entries(obj || {});
    if (!entries.length) return `<p class="muted small">${esc(t('noAttrs'))}</p>`;
    return `<table class="kv"><tbody>${entries.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="mono">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</tbody></table>`;
  }

  function selectSpan(spanId, pushHash) {
    const data = state.trace;
    const s = data._tree.byId.get(spanId);
    if (!s) return;
    state.selected = spanId;
    document.querySelectorAll('.wf-row.selected').forEach((r) => r.classList.remove('selected'));
    document.querySelector(`.wf-row[data-span="${spanId}"]`)?.classList.add('selected');
    if (pushHash) history.replaceState(null, '', `#/trace/${data.trace_id}?span=${spanId}`);
    const logs = state.logScope === 'trace' ? data.logs : data.logs.filter((l) => l.span_id === spanId);
    const err = s.status_code === 2;
    const exc = s.events.filter((e) => e.name === 'exception');
    $('#detail').innerHTML = `
      <h3 class="dname" data-testid="detail-name"><span class="dot" style="background:${svcColor(s.service)}"></span>${esc(s.name)}</h3>
      <dl class="facts">
        <dt>${esc(t('service'))}</dt><dd>${esc(s.service)}</dd>
        <dt>${esc(t('kind'))}</dt><dd>${esc(t('kind' + s.kind))}</dd>
        <dt>${esc(t('status'))}</dt><dd data-testid="detail-status"><span class="badge ${err ? 'err' : 'ok'}">${esc(t('status' + s.status_code))}</span></dd>
        ${s.status_message ? `<dt>${esc(t('statusMessage'))}</dt><dd class="errtext">${esc(s.status_message)}</dd>` : ''}
        <dt>${esc(t('duration'))}</dt><dd data-testid="detail-duration">${esc(fmtDur(s.duration_us))}</dd>
        <dt>${esc(t('offset'))}</dt><dd>+${esc(fmtDur(s.start_us - data._t0))}</dd>
        <dt>${esc(t('spanId'))}</dt><dd class="mono">${esc(s.span_id)}</dd>
        <dt>${esc(t('parentId'))}</dt><dd class="mono">${s.parent_span_id ? `<a href="#/trace/${data.trace_id}?span=${s.parent_span_id}">${esc(s.parent_span_id)}</a>` : `(${esc(t('root'))})`}</dd>
        <dt>${esc(t('scope'))}</dt><dd class="mono small">${esc(s.scope)}</dd>
      </dl>
      ${exc.length ? `<div class="excbox" data-testid="detail-exception"><b>${esc(t('exception'))}</b>${exc.map((e) => `<div class="mono small">${esc(e.attributes['exception.type'] || '')}: ${esc(e.attributes['exception.message'] || '')}</div>${e.attributes['exception.stacktrace'] ? `<details><summary>stack</summary><pre>${esc(e.attributes['exception.stacktrace'])}</pre></details>` : ''}`).join('')}</div>` : ''}
      <h4>${esc(t('attributes'))}</h4><div data-testid="detail-attributes">${kv(s.attributes)}</div>
      <h4>${esc(t('events'))}</h4>
      ${s.events.length ? `<ul class="events" data-testid="detail-events">${s.events.map((e) => `<li><span class="mono small muted">+${esc(fmtDur(e.time_us - data._t0))}</span> <b>${esc(e.name)}</b>${Object.keys(e.attributes).length && e.name !== 'exception' ? kv(e.attributes) : ''}</li>`).join('')}</ul>` : `<p class="muted small">${esc(t('noEvents'))}</p>`}
      <h4>${esc(t('logs'))} <button type="button" class="linkbtn" id="logScopeBtn" data-testid="log-scope">${esc(state.logScope === 'trace' ? t('logsOfSpan') : t('logsOfTrace'))}</button></h4>
      ${logs.length ? `<ul class="logs" data-testid="detail-logs">${logs.map((l) => `<li class="lv-${esc(l.severity.toLowerCase())}"><span class="mono small muted">${esc(fmtTime(l.time_us).slice(-12))}</span> <span class="lvl">${esc(l.severity)}</span> <span class="chip" style="--c:${svcColor(l.service)}">${esc(l.service)}</span> ${esc(l.body)}${Object.keys(l.attributes).length ? ` <span class="mono small muted">${esc(JSON.stringify(l.attributes))}</span>` : ''}</li>`).join('')}</ul>` : `<p class="muted small" data-testid="detail-logs-empty">${esc(t('noLogs'))}</p>`}
      <details><summary>${esc(t('resource'))}</summary>${kv(s.resource)}</details>`;
    $('#logScopeBtn').addEventListener('click', () => { state.logScope = state.logScope === 'trace' ? 'span' : 'trace'; selectSpan(spanId, false); });
  }

  // ---------- router ----------
  function route() {
    const h = location.hash || '#/';
    const m = /^#\/trace\/([0-9a-f]{32})(?:\?span=([0-9a-f]{16}))?/.exec(h);
    if (m) {
      return renderTrace(m[1], m[2]);
    }
    state.trace = null;
    return renderList();
  }
  function routeAll() {
    loadStats().catch(() => {});
    return route();
  }
  window.addEventListener('hashchange', () => {
    const m = /^#\/trace\/([0-9a-f]{32})\?span=([0-9a-f]{16})/.exec(location.hash);
    if (m && state.trace && state.trace.trace_id === m[1] && !$('#traceView').hidden) { selectSpan(m[2], false); return; }
    routeAll();
  });

  applyTheme();
  applyLang();
  routeAll();
})();
