// Page controller: UI rendering, SW registration + update flow, sync orchestration.
import { t, setLang, getLang, applyI18n } from './i18n.js';

const core = self.OutboxCore;
const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const state = {
  reg: null, buildId: null, waiting: null, refreshing: false, syncing: null,
  lastSync: null, bgSync: false, editing: null, photo: null, online: navigator.onLine,
  noFallback: params.get('nofallback') === '1', // test/debug: rely on Background Sync only
};

function dbg(...a) { if (DEBUG) console.debug('[pwa]', ...a); }
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage blocked */ } return null; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(iso) {
  if (!iso) return t('never');
  try { return new Date(iso).toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-TW', { hour12: false }); } catch { return iso; }
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ---------- language / theme ----------
function initLang() {
  const saved = store('pwa.lang');
  setLang(params.get('lang') || saved || 'zh-TW');
  applyI18n();
  $('#lang-btn').textContent = t('langBtn');
}
function toggleLang() {
  setLang(getLang() === 'zh-TW' ? 'en' : 'zh-TW');
  store('pwa.lang', getLang());
  applyI18n();
  $('#lang-btn').textContent = t('langBtn');
  applyTheme($('#theme-btn').dataset.theme || 'auto');
  $('#form-title').textContent = state.editing ? t('formEdit') : t('formNew');
  renderAll();
}
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(th) {
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  $('#theme-btn').textContent = t('theme' + th[0].toUpperCase() + th.slice(1));
  $('#theme-btn').dataset.theme = th;
}
function toggleTheme() {
  const cur = $('#theme-btn').dataset.theme || 'auto';
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  store('pwa.theme', next); applyTheme(next);
  toast(t('theme' + next[0].toUpperCase() + next.slice(1)));
}

// ---------- rendering ----------
const statusLabel = (s) => t({ ok: 'stOk', issue: 'stIssue', fixed: 'stFixed' }[s] || 'stOk');

async function renderRecords() {
  const [records, outbox] = await Promise.all([core.listRecords(), core.listOutbox()]);
  const pendingIds = new Set(outbox.map((o) => o.recordId));
  const list = records.filter((r) => !r.deleted).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('#record-list').innerHTML = list.map((r) => `
    <li class="record" data-id="${esc(r.id)}" data-version="${r.version}">
      <div>
        <div class="title">${esc(r.title)}<span class="tag st-${esc(r.status)}">${esc(statusLabel(r.status))}</span>${pendingIds.has(r.id) ? `<span class="tag pending">${t('tagPending')}</span>` : ''}${r.conflict ? `<span class="tag conflict">${t('tagConflict')}</span>` : ''}${r.error ? `<span class="tag error" title="${esc(r.error)}">${t('tagError')}</span>` : ''}</div>
        <div class="meta">${r.location ? esc(r.location) + ' · ' : ''}${t('updatedAt')} ${esc(fmtTime(r.updatedAt))}${r.version ? ' · ' + t('byVersion', { v: r.version }) : ''}</div>
      </div>
      <div class="btns">
        <button type="button" class="btn small edit-btn" ${r.conflict ? 'disabled' : ''}>${t('edit')}</button>
        <button type="button" class="btn small ghost danger delete-btn" ${r.conflict ? 'disabled' : ''}>${t('del')}</button>
      </div>
      ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
      ${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : ''}
    </li>`).join('');
  $('#empty-msg').hidden = list.length > 0;
  $('#record-count').textContent = list.length ? `(${list.length})` : '';
}

function conflictCol(title, r) {
  if (!r) return `<div class="col"><h3>${title}</h3><em>${t('deletedMark')}</em></div>`;
  return `<div class="col"><h3>${title} ${r.version !== undefined ? t('byVersion', { v: r.version }) : ''} ${r.deleted ? t('deletedMark') : ''}</h3>
    <div><b>${esc(r.title)}</b> <span class="tag st-${esc(r.status)}">${esc(statusLabel(r.status))}</span></div>
    <div class="muted">${esc(r.location || '')}</div><div>${esc(r.note || '')}</div>
    <div class="muted">${esc(fmtTime(r.updatedAt))}${r.updatedBy ? ' · ' + esc(r.updatedBy) : ''}</div></div>`;
}
async function renderConflicts() {
  const conflicts = await core.listConflicts();
  $('#conflict-section').hidden = conflicts.length === 0;
  $('#conflict-list').innerHTML = conflicts.map((c) => `
    <div class="conflict" data-id="${esc(c.id)}">
      <div class="cols">${conflictCol(t('mine'), c.mine)}${conflictCol(t('theirs'), c.theirs)}</div>
      <div class="actions">
        <button type="button" class="btn primary keep-mine">${t('keepMine')}</button>
        <button type="button" class="btn take-theirs">${t('takeTheirs')}</button>
      </div>
    </div>`).join('');
}

async function renderStatus() {
  const c = await core.counts();
  $('#pending-count').textContent = String(c.pending);
  $('#pending-pill').dataset.count = String(c.pending);
  $('#stat-pending').textContent = c.pending;
  $('#stat-conflicts').textContent = c.conflicts;
  $('#stat-records').textContent = c.records;
  $('#stat-last').textContent = fmtTime(state.lastSync);
  $('#stat-bgsync').textContent = state.bgSync ? t('supported') : t('notSupported');
  const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
  $('#stat-sw').textContent = !state.reg ? t('swNone') : ctl ? `${t('swActive')} (${state.buildId || '?'})` : t('swNotControlled');
  $('#build-id').textContent = state.buildId || '-';
  const net = $('#net-status');
  net.dataset.state = state.online ? 'online' : 'offline';
  $('.txt', net).textContent = state.online ? t('online') : t('offline');
}

async function renderLog() {
  const entries = await core.getLog();
  const ol = $('#sync-log');
  if (!entries.length) { ol.innerHTML = `<li class="muted">${t('logEmpty')}</li>`; return; }
  ol.innerHTML = entries.slice(-100).reverse().map((e) =>
    `<li class="${esc(e.level)}">${esc(e.ts.slice(11, 19))} [${esc(e.source)}] ${esc(e.msg)}${e.data ? ' ' + esc(JSON.stringify(e.data)) : ''}</li>`).join('');
}

let renderQueued = null;
function renderAll() {
  if (renderQueued) return renderQueued;
  renderQueued = new Promise((r) => setTimeout(r, 30)).then(() => {
    renderQueued = null;
    return Promise.all([renderRecords(), renderConflicts(), renderStatus(), renderLog()]);
  }).catch((e) => console.warn('render failed', e));
  return renderQueued;
}

// ---------- form ----------
function resetForm() {
  state.editing = null; state.photo = null;
  $('#record-form').reset();
  $('#f-id').value = '';
  $('#form-title').textContent = t('formNew');
  $('#cancel-btn').hidden = true;
  $('#form-error').hidden = true;
  showPhoto(null);
}
function showPhoto(dataUrl) {
  state.photo = dataUrl;
  $('#photo-preview').hidden = !dataUrl;
  if (dataUrl) $('#photo-preview img').src = dataUrl; else $('#photo-preview img').removeAttribute('src');
}
async function resizePhoto(file, max = 800) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.72);
}
async function startEdit(id) {
  const r = await core.getRecord(id);
  if (!r) return;
  state.editing = id;
  $('#f-id').value = id;
  $('#f-title').value = r.title || '';
  $('#f-location').value = r.location || '';
  $('#f-status').value = r.status || 'ok';
  $('#f-note').value = r.note || '';
  showPhoto(r.photo || null);
  $('#form-title').textContent = t('formEdit');
  $('#cancel-btn').hidden = false;
  $('#f-title').focus();
  $('#record-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function onSubmit(ev) {
  ev.preventDefault();
  const data = {
    title: $('#f-title').value.trim(), location: $('#f-location').value.trim(),
    status: $('#f-status').value, note: $('#f-note').value, photo: state.photo || null,
  };
  if (!data.title) { const e = $('#form-error'); e.textContent = t('titleRequired'); e.hidden = false; $('#f-title').focus(); return; }
  try {
    const rec = state.editing ? await core.saveLocal('update', state.editing, data) : await core.saveLocal('create', null, data);
    dbg('saved locally', rec);
    resetForm();
    await renderAll();
    toast(t('saved', { state: t('savedQueued') }));
    requestSync('save');
  } catch (e) {
    const el = $('#form-error'); el.textContent = String(e.message || e); el.hidden = false;
  }
}

// ---------- sync ----------
async function registerBackgroundSync() {
  try {
    if (state.reg && 'sync' in state.reg) { await state.reg.sync.register('outbox-sync'); dbg('background sync registered'); state.bgSync = true; return true; }
  } catch (e) { dbg('background sync register failed (fallback: online event + timer)', e); }
  state.bgSync = false;
  return false;
}

async function pull() {
  const res = await fetch('/api/records', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const changed = await core.mergeServer(j.records || []);
  dbg('pull', { count: j.records?.length, changed, cache: res.headers.get('X-SW-Cache') || 'network' });
  return changed;
}

/** Replay in the Service Worker when it controls the page (single sync engine); otherwise in the page. */
function replay(reason) {
  const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!ctl) return core.replay({ source: 'page:' + reason });
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(core.replay({ source: 'page-fallback:' + reason })), 20000);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data.ok ? e.data.res : { error: e.data.error }); };
    ctl.postMessage({ type: 'REPLAY', reason }, [ch.port2]);
  });
}

/** Replay outbox then pull. Serialised; safe to call often. */
function sync(reason = 'manual') {
  if (state.syncing) return state.syncing;
  state.syncing = (async () => {
    if (!navigator.onLine) { dbg('sync skipped: offline', reason); return { offline: true }; }
    dbg('sync start', reason);
    const res = await replay(reason);
    if (!res.networkError && !res.error) {
      try { await pull(); } catch (e) { dbg('pull failed', e); }
      state.lastSync = new Date().toISOString();
      await core.setMeta('lastSync', state.lastSync);
    }
    return res;
  })().catch((e) => { console.warn('sync failed', e); return { error: String(e) }; })
    .finally(() => { state.syncing = null; renderAll(); });
  return state.syncing;
}

async function requestSync(reason) {
  await registerBackgroundSync();    // lets the browser replay later even if this tab is closed
  if (navigator.onLine) return sync(reason);
  toast(t('syncOffline'));
  return { offline: true };
}

function setOnline(on) {
  state.online = on;
  if (on) $('#toast').hidden = true;
  renderStatus();
  core.addLog(on ? 'info' : 'warn', on ? 'online' : 'offline', null, 'page');
  if (on && !state.noFallback) sync('online-event');   // fallback for browsers without Background Sync
}

// ---------- service worker + update flow ----------
function showUpdateBanner(worker) {
  state.waiting = worker;
  $('#update-banner').hidden = false;
  dbg('update waiting', worker);
}
function applyUpdate() {
  const w = state.waiting || state.reg?.waiting;
  if (!w) return false;
  state.refreshing = true;           // reload once the new worker takes control
  w.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
function trackInstalling(worker) {
  worker.addEventListener('statechange', () => {
    dbg('sw state', worker.state);
    // An installed worker while a controller exists = update ready (first install activates directly).
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
    if (worker.state === 'activated') askVersion();
  });
}
function askVersion() {
  const ctl = navigator.serviceWorker.controller;
  if (ctl) ctl.postMessage({ type: 'GET_VERSION' });
  if (ctl && DEBUG) ctl.postMessage({ type: 'SET_DEBUG', value: true });
}
async function checkUpdate() {
  if (!state.reg) return null;
  await state.reg.update();
  return !!(state.reg.waiting || state.reg.installing);
}
async function initSW() {
  if (!('serviceWorker' in navigator)) { dbg('no service worker support'); return; }
  try {
    state.reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) { console.warn('SW registration failed', e); return; }
  state.bgSync = 'sync' in state.reg;
  if (state.reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(state.reg.waiting);
  if (state.reg.installing) trackInstalling(state.reg.installing);
  state.reg.addEventListener('updatefound', () => trackInstalling(state.reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    dbg('controllerchange', { refreshing: state.refreshing });
    if (state.refreshing) { state.refreshing = false; location.reload(); return; }
    askVersion(); renderStatus();
  });
  navigator.serviceWorker.addEventListener('message', async (e) => {
    const m = e.data || {};
    if (m.type === 'VERSION') { state.buildId = m.buildId; renderStatus(); }
    if (m.type === 'API_UPDATED' && m.url.endsWith('/api/records')) {
      try { await core.mergeServer(JSON.parse(m.body).records || []); } catch (err) { dbg('merge API_UPDATED failed', err); }
    }
  });
  askVersion();
  // Look for updates when the app comes back to the foreground and hourly.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) state.reg.update().catch(() => {}); });
  setInterval(() => { if (navigator.onLine) state.reg.update().catch(() => {}); }, 60 * 60 * 1000);
}

// ---------- events ----------
function bind() {
  $('#lang-btn').addEventListener('click', toggleLang);
  $('#theme-btn').addEventListener('click', toggleTheme);
  $('#record-form').addEventListener('submit', onSubmit);
  $('#cancel-btn').addEventListener('click', resetForm);
  $('#f-photo').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { showPhoto(await resizePhoto(f)); } catch (err) { const el = $('#form-error'); el.textContent = String(err); el.hidden = false; }
  });
  $('#photo-remove').addEventListener('click', () => { showPhoto(null); $('#f-photo').value = ''; });
  $('#record-list').addEventListener('click', async (e) => {
    const li = e.target.closest('.record'); if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.edit-btn')) startEdit(id);
    if (e.target.closest('.delete-btn')) {
      const r = await core.getRecord(id);
      if (!confirm(t('confirmDelete', { title: r?.title || id }))) return;
      await core.saveLocal('delete', id, {});
      if (state.editing === id) resetForm();
      renderAll(); requestSync('delete');
    }
  });
  $('#conflict-list').addEventListener('click', async (e) => {
    const box = e.target.closest('.conflict'); if (!box) return;
    const choice = e.target.closest('.keep-mine') ? 'mine' : e.target.closest('.take-theirs') ? 'theirs' : null;
    if (!choice) return;
    await core.resolveConflict(box.dataset.id, choice);
    toast(choice === 'mine' ? t('resolvedMine') : t('resolvedTheirs'));
    renderAll();
    if (choice === 'mine') requestSync('resolve');
  });
  $('#sync-btn').addEventListener('click', async () => {
    if (!navigator.onLine) { toast(t('syncOffline')); return; }
    toast(t('syncing'));
    const r = await sync('button');
    if (r.networkError) toast(t('syncFail', { err: r.networkError }));
    else if (!r.offline && !r.error) toast(t('syncDone', { ok: r.ok, conflicts: r.conflicts, remaining: r.remaining }));
  });
  $('#clear-log-btn').addEventListener('click', async () => { await core.clearLog(); renderLog(); });
  $('#reset-btn').addEventListener('click', async () => { if (confirm(t('confirmReset'))) { await core.resetAll(); resetForm(); renderAll(); } });
  $('#reload-btn').addEventListener('click', () => { if (!applyUpdate()) location.reload(); });
  $('#later-btn').addEventListener('click', () => { $('#update-banner').hidden = true; });
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  core.on((m) => {
    if (m.type === 'changed' || m.type === 'log') renderAll();
    if (DEBUG && m.type === 'log') console.debug('[sync]', m.entry.source, m.entry.msg, m.entry.data || '');
  });
  // Safety net: retry periodically while items are pending (covers missed online events).
  setInterval(async () => {
    if (!navigator.onLine || state.syncing || state.noFallback) return;
    const c = await core.counts();
    if (c.pending > 0) sync('timer');
  }, 15000);
  if (DEBUG) {
    $('#debug-flag').hidden = false;
    $('#sync-panel').open = true;
    const report = (level, msg, data) => fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, msg, data }) }).catch(() => {});
    window.addEventListener('error', (e) => report('error', e.message, { src: e.filename, line: e.lineno }));
    window.addEventListener('unhandledrejection', (e) => report('error', String(e.reason)));
  }
}

// ---------- DevTools handle ----------
window.__pwa = {
  core, state, sync, pull, replay, checkUpdate, applyUpdate, t,
  counts: () => core.counts(),
  records: () => core.listRecords(),
  outbox: () => core.listOutbox(),
  conflicts: () => core.listConflicts(),
  log: () => core.getLog(),
  render: () => renderAll(),
  ready: null,
};

async function main() {
  initLang();
  applyTheme(store('pwa.theme') || 'auto');
  bind();
  state.lastSync = await core.getMeta('lastSync').catch(() => null);
  await renderAll();
  await initSW();
  await renderStatus();
  if (navigator.onLine) await sync('startup');
  dbg('ready', { debug: DEBUG, lang: getLang() });
}
window.__pwa.ready = main().catch((e) => { console.warn('init failed', e); });
