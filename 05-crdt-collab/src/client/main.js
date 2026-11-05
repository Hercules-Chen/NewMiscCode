// Browser entry: wires Y.Doc <-> IndexedDB (offline) <-> WebSocket provider (sync) <-> UI.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { TextareaBinding } from './binding.js';
import { RemoteCursors } from './cursors.js';
import { renderMarkdown } from './markdown.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};

// ---------- debug ----------
let DEBUG = params.get('debug') === '1' || store.get('collab.debug') === '1';
const debugLines = [];
function dbg(event, data) {
  const line = `${new Date().toISOString().slice(11, 23)} ${event}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;
  debugLines.push(line);
  if (debugLines.length > 200) debugLines.shift();
  if (DEBUG) console.debug('[collab]', event, data ?? '');
  if (!$('debugPanel').hidden) $('debugLog').textContent = debugLines.slice(-40).join('\n');
}

// ---------- settings ----------
const room = /^[A-Za-z0-9_-]{1,64}$/.test(params.get('room') || '') ? params.get('room') : 'demo';
setLang(params.get('lang') || store.get('collab.lang') || 'zh-TW');
const PALETTE = ['#d9480f', '#2b8a3e', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#e67700', '#5f3dc4'];
let user;
try { user = JSON.parse(store.get('collab.user') || 'null'); } catch { user = null; }
if (!user || !user.name || !user.color) {
  user = { name: `${getLang() === 'en' ? 'Guest' : '訪客'} ${Math.floor(100 + Math.random() * 900)}`, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] };
}
if (params.get('name')) user.name = params.get('name').slice(0, 24);
if (params.get('color') && /^#[0-9a-fA-F]{6}$/.test(params.get('color'))) user.color = params.get('color');
store.set('collab.user', JSON.stringify(user));

// ---------- CRDT document ----------
// transaction origins for edits made in this tab (both tracked by the undo manager):
const LOCAL = { name: 'local-ui' }; // task board, history restore, ...
const TYPING = { name: 'textarea' }; // the textarea binding (it ignores its own origin when observing)
const doc = new Y.Doc();
const ytext = doc.getText('notes');
const ytasks = doc.getArray('tasks');

const idb = new IndexeddbPersistence(`crdt-collab:${room}`, doc);
let idbSynced = false;
idb.on('synced', () => { idbSynced = true; dbg('idb.synced', { textLength: ytext.length, tasks: ytasks.length }); refreshStatus(); });

const wsBase = params.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const provider = new WebsocketProvider(wsBase, room, doc, { maxBackoffTime: 2500 });
const awareness = provider.awareness;
awareness.setLocalStateField('user', user);

const undoManager = new Y.UndoManager([ytext, ytasks], { trackedOrigins: new Set([LOCAL, TYPING]), captureTimeout: 400 });

let simulatedOffline = false;
let pendingLocal = 0;
let updateCount = 0;
doc.on('update', (update, origin) => {
  updateCount++;
  const local = origin === LOCAL || origin === TYPING || origin === undoManager;
  if (local && !(provider.wsconnected && provider.synced)) pendingLocal++;
  dbg('doc.update', { bytes: update.length, origin: local ? 'local' : origin === provider ? 'remote' : origin === idb ? 'indexeddb' : String(origin?.constructor?.name || origin) });
  if (local) refreshStatus();
});
provider.on('status', ({ status }) => { dbg('ws.status', { status }); refreshStatus(); });
provider.on('sync', synced => {
  dbg('ws.sync', { synced });
  if (synced) pendingLocal = 0;
  refreshStatus();
});
provider.on('connection-error', () => dbg('ws.connection_error'));
provider.on('connection-close', ev => dbg('ws.connection_close', { code: ev?.code }));

// ---------- status bar ----------
function refreshStatus() {
  const el = $('status');
  let state;
  if (simulatedOffline) state = 'simulated';
  else if (provider.wsconnected && provider.synced) state = 'connected';
  else if (provider.shouldConnect && provider.wsUnsuccessfulReconnects <= 1) state = 'connecting';
  else state = 'disconnected';
  el.dataset.state = state;
  el.textContent = t(`status_${state}`);
  const p = $('pending');
  p.hidden = pendingLocal === 0;
  p.textContent = t('pending', { n: pendingLocal });
  $('btnConn').textContent = t(simulatedOffline ? 'btnReconnect' : 'btnDisconnect');
  document.body.dataset.conn = state;
}

$('btnConn').addEventListener('click', () => {
  simulatedOffline = !simulatedOffline;
  if (simulatedOffline) provider.disconnect(); else provider.connect();
  dbg('ui.simulated_offline', { on: simulatedOffline });
  refreshStatus();
});
window.addEventListener('online', () => { dbg('browser.online'); refreshStatus(); });
window.addEventListener('offline', () => { dbg('browser.offline'); refreshStatus(); });

// ---------- notes editor ----------
const ta = $('notes');
const binding = new TextareaBinding(ytext, ta, {
  origin: TYPING,
  dbg,
  onChange: () => { if (document.activeElement === ta) cursors.publishLocal(); if (!$('mdPreview').hidden) renderPreview(); }
});
const cursors = new RemoteCursors({ textarea: ta, layer: $('cursorLayer'), ytext, awareness });
document.addEventListener('selectionchange', () => {
  if (document.activeElement === ta && !binding.composing) cursors.publishLocal();
});
ta.addEventListener('keydown', e => {
  if (binding.composing || e.isComposing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoManager.undo(); dbg('undo'); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoManager.redo(); dbg('redo'); }
});
$('btnUndo').addEventListener('click', () => undoManager.undo());
$('btnRedo').addEventListener('click', () => undoManager.redo());
function renderPreview() { $('mdPreview').innerHTML = renderMarkdown(ytext.toString()); }
$('btnPreview').addEventListener('click', () => {
  const show = $('mdPreview').hidden;
  $('mdPreview').hidden = !show;
  $('editorWrap').hidden = show;
  $('btnPreview').dataset.i18n = show ? 'edit' : 'preview';
  $('btnPreview').textContent = t($('btnPreview').dataset.i18n);
  if (show) renderPreview(); else cursors.copyStyle();
});

// ---------- presence ----------
function renderPresence() {
  const ul = $('presence');
  ul.textContent = '';
  const states = [...awareness.getStates().entries()].filter(([, s]) => s?.user).sort(([a], [b]) => (a === doc.clientID ? -1 : b === doc.clientID ? 1 : a - b));
  for (const [id, s] of states) {
    const li = document.createElement('li');
    li.dataset.client = String(id);
    li.style.setProperty('--c', s.user.color);
    li.textContent = s.user.name + (id === doc.clientID ? t('youTag') : '');
    if (id === doc.clientID) li.classList.add('self');
    ul.appendChild(li);
  }
}
awareness.on('change', renderPresence);
const nameInput = $('userName');
nameInput.value = user.name;
$('userColor').style.background = user.color;
nameInput.addEventListener('input', () => {
  const v = nameInput.value.trim();
  if (!v) return;
  user.name = v;
  store.set('collab.user', JSON.stringify(user));
  awareness.setLocalStateField('user', { ...user });
});

// ---------- tasks ----------
function renderTasks() {
  const ul = $('taskList');
  ul.textContent = '';
  let done = 0;
  ytasks.forEach(ymap => {
    if (!(ymap instanceof Y.Map)) return;
    const li = document.createElement('li');
    li.className = 'task';
    li.dataset.id = ymap.get('id');
    if (ymap.get('done')) { li.classList.add('done'); done++; }
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!ymap.get('done');
    cb.addEventListener('change', () => doc.transact(() => ymap.set('done', cb.checked), LOCAL));
    const label = document.createElement('span');
    label.className = 'task-text';
    label.textContent = ymap.get('text');
    const by = document.createElement('small');
    by.className = 'muted';
    by.textContent = t('taskBy', { name: ymap.get('by') || '?' });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn small del';
    del.textContent = '✕';
    del.title = t('deleteTask');
    del.setAttribute('aria-label', t('deleteTask'));
    del.addEventListener('click', () => {
      const i = ytasks.toArray().indexOf(ymap);
      if (i >= 0) doc.transact(() => ytasks.delete(i, 1), LOCAL);
    });
    const body = document.createElement('label');
    body.className = 'task-body';
    body.append(cb, label);
    li.append(body, by, del);
    ul.appendChild(li);
  });
  $('noTasks').hidden = ytasks.length > 0;
  $('taskStats').textContent = ytasks.length ? t('taskStats', { done, total: ytasks.length }) : '';
}
ytasks.observeDeep(renderTasks);
function addTask(text, by = user.name) {
  const m = new Y.Map([['id', `${doc.clientID.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`], ['text', text], ['done', false], ['by', by], ['createdAt', Date.now()]]);
  doc.transact(() => ytasks.push([m]), LOCAL);
}
$('taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('taskInput');
  const v = input.value.trim();
  if (!v) return;
  addTask(v);
  input.value = '';
});
$('btnClearDone').addEventListener('click', () => {
  doc.transact(() => {
    for (let i = ytasks.length - 1; i >= 0; i--) if (ytasks.get(i).get('done')) ytasks.delete(i, 1);
  }, LOCAL);
});

// ---------- version history (server snapshots) ----------
const dlg = $('historyDlg');
let viewed = null;
const api = path => `${location.origin}/api/rooms/${encodeURIComponent(room)}${path}`;
async function loadVersions() {
  const ul = $('versionList');
  ul.textContent = '';
  $('versionView').hidden = true;
  try {
    const r = await fetch(api('/versions'));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json();
    if (!list.length) $('historyMsg').textContent = t('noVersions');
    for (const v of list) {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.textContent = `${v.label || v.id} · ${new Date(v.createdAt).toLocaleString(getLang())} · ${v.author || ''}`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = t('previewVersion');
      b.addEventListener('click', () => viewVersion(v.id));
      li.append(info, b);
      ul.appendChild(li);
    }
  } catch (err) {
    $('historyMsg').textContent = t('versionSaveFailed');
    dbg('history.list_failed', { error: String(err) });
  }
}
async function viewVersion(id) {
  const r = await fetch(api(`/versions/${id}`));
  const bin = new Uint8Array(await r.arrayBuffer());
  const vdoc = new Y.Doc();
  Y.applyUpdate(vdoc, bin);
  viewed = { text: vdoc.getText('notes').toString(), tasks: vdoc.getArray('tasks').toJSON() };
  vdoc.destroy();
  $('versionNotes').textContent = viewed.text;
  const ul = $('versionTasks');
  ul.textContent = '';
  for (const tk of viewed.tasks) {
    const li = document.createElement('li');
    li.textContent = `${tk.done ? '☑' : '☐'} ${tk.text}`;
    ul.appendChild(li);
  }
  $('versionView').hidden = false;
}
$('btnHistory').addEventListener('click', () => { $('historyMsg').textContent = ''; dlg.showModal(); loadVersions(); });
$('btnCloseHistory').addEventListener('click', () => dlg.close());
$('versionForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const r = await fetch(api('/versions'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: $('versionLabel').value.trim(), author: user.name }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    $('versionLabel').value = '';
    $('historyMsg').textContent = '';
    await loadVersions();
  } catch (err) {
    $('historyMsg').textContent = t('versionSaveFailed');
    dbg('history.save_failed', { error: String(err) });
  }
});
$('btnRestore').addEventListener('click', () => {
  if (!viewed) return;
  const v = viewed;
  doc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, v.text);
    ytasks.delete(0, ytasks.length);
    ytasks.push(v.tasks.map(tk => new Y.Map(Object.entries(tk))));
  }, LOCAL);
  $('historyMsg').textContent = t('restored');
  dbg('history.restored');
});

// ---------- language / theme / debug ----------
function rerenderAll() { applyI18n(); refreshStatus(); renderPresence(); renderTasks(); $('btnPreview').textContent = t($('btnPreview').dataset.i18n || 'preview'); }
$('btnLang').addEventListener('click', () => {
  setLang(getLang() === 'zh-TW' ? 'en' : 'zh-TW');
  store.set('collab.lang', getLang());
  rerenderAll();
});
const themeIcon = () => { $('btnTheme').textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; };
$('btnTheme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('collab.theme', next);
  themeIcon();
});
themeIcon();
let debugTimer = null;
function renderDebug() {
  const sv = Y.decodeStateVector(Y.encodeStateVector(doc));
  $('debugInfo').textContent = JSON.stringify({
    room, clientID: doc.clientID, user, ws: wsBase, wsconnected: provider.wsconnected, synced: provider.synced, simulatedOffline,
    indexeddbSynced: idbSynced, textLength: ytext.length, tasks: ytasks.length, docBytes: Y.encodeStateAsUpdate(doc).length,
    updates: updateCount, pendingLocal, awarenessPeers: awareness.getStates().size, undoStack: undoManager.undoStack.length,
    stateVector: Object.fromEntries(sv)
  }, null, 2);
  $('debugLog').textContent = debugLines.slice(-40).join('\n');
}
function toggleDebug(on) {
  $('debugPanel').hidden = !on;
  clearInterval(debugTimer);
  if (on) { renderDebug(); debugTimer = setInterval(renderDebug, 1000); }
}
$('btnDebug').addEventListener('click', () => toggleDebug($('debugPanel').hidden));

// ---------- boot ----------
$('roomName').textContent = room;
document.title = `${t('appTitle')} · ${room}`;
rerenderAll();
if (DEBUG) toggleDebug(true);
if ('serviceWorker' in navigator && window.isSecureContext && params.get('sw') !== '0') {
  navigator.serviceWorker.register('sw.js').then(() => dbg('sw.registered'), err => dbg('sw.failed', { error: String(err) }));
}

window.__collab = {
  Y, doc, ytext, ytasks, provider, awareness, undoManager, idb, binding, room, user,
  get debugLines() { return debugLines.slice(); },
  setDebug(on) { DEBUG = !!on; store.set('collab.debug', on ? '1' : '0'); toggleDebug(DEBUG); },
  text: () => ytext.toString(),
  tasks: () => ytasks.toJSON(),
  addTask,
  isIdbSynced: () => idbSynced,
  status: () => document.body.dataset.conn
};
dbg('boot', { room, clientID: doc.clientID, lang: getLang() });
