// Browser app: bundled by esbuild into public/build/app.js (no CDN).
import {
  startRegistration, startAuthentication, browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill, WebAuthnAbortService,
} from '@simplewebauthn/browser';
import { DICT } from './i18n.js';

const $ = sel => document.querySelector(sel);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: ignore */ } },
};
let lang = store.get('pk.lang') || 'zh-TW';
let config = null;
let me = null;

function t(key, ...args) {
  const s = DICT[lang][key] ?? DICT['zh-TW'][key] ?? key;
  return s.replace(/\{(\d)\}/g, (_, i) => args[i] ?? '');
}

function applyI18n() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $('#langBtn').textContent = lang === 'en' ? '中文' : 'EN';
  document.title = t('app.title');
  if (config) $('#rpInfo').textContent = t('footer', config.rpID, config.origins.join(', '), config.debug ? ' · --debug' : '');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#themeBtn').textContent = theme === 'dark' ? '☀' : '☾';
  store.set('pk.theme', theme);
}

let msgTimer;
function showMsg(kind, text) {
  const el = $('#msg');
  el.className = `msg ${kind}`; el.textContent = text; el.hidden = false; el.dataset.kind = kind;
  clearTimeout(msgTimer);
  if (kind === 'ok') msgTimer = setTimeout(() => { el.hidden = true; }, 6000);
}
const clearMsg = () => { $('#msg').hidden = true; };

class ApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch (err) {
    throw new ApiError('network', err.message, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error?.code || 'generic', data.error?.message || res.statusText, res.status);
  return data;
}

/** Map WebAuthn DOMExceptions and server error codes to friendly, localized text. */
function friendlyError(err) {
  if (err instanceof ApiError) {
    const key = `err.${err.code}`;
    return DICT[lang][key] ? t(key, err.message) : t('err.generic', err.message);
  }
  const name = err?.name || '';
  if (name === 'SecurityError') return t('err.SecurityError', location.origin, config?.origins?.[0] ?? '');
  if (DICT[lang][`err.${name}`]) return t(`err.${name}`);
  return t('err.generic', err?.message || String(err));
}
const isAbort = err => err?.name === 'AbortError' || err?.code === 'ERROR_CEREMONY_ABORTED';

async function withBusy(btn, fn) {
  btn.disabled = true;
  showMsg('warn', t('busy'));
  try { await fn(); } catch (err) {
    if (isAbort(err)) { clearMsg(); return; }
    console.warn('[passkeys]', err.name || err.code, err.message);
    showMsg('error', friendlyError(err));
  } finally { btn.disabled = false; }
}

// ---------- ceremonies ----------
async function register(username, displayName, name) {
  const optionsJSON = await api('/api/register/options', { method: 'POST', body: { username, displayName } });
  const response = await startRegistration({ optionsJSON });
  return api('/api/register/verify', { method: 'POST', body: { response, name } });
}

async function login(username, { autofill = false } = {}) {
  const optionsJSON = await api('/api/login/options', { method: 'POST', body: { username: username || undefined } });
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
  return api('/api/login/verify', { method: 'POST', body: { response } });
}

async function startConditionalUI() {
  // Passkey autofill: a pending get() with mediation "conditional". Aborted automatically when another ceremony starts.
  if (new URLSearchParams(location.search).get('autofill') === '0') return;
  if (!(await browserSupportsWebAuthnAutofill())) return;
  try {
    const r = await login(undefined, { autofill: true });
    await afterLogin(r);
  } catch (err) {
    if (!isAbort(err)) showMsg('error', friendlyError(err));
  }
}

async function afterLogin(r) {
  await refreshMe();
  showMsg('ok', t('ok.login', r.user.displayName || r.user.username));
  await navigate('/account');
}

// ---------- views ----------
async function refreshMe() {
  me = (await api('/api/me')).user;
  document.querySelector('[data-view="account"]').hidden = !me;
  document.querySelector('[data-view="debug"]').hidden = !config?.debug;
}

function fmtDate(s) { return s ? new Date(s).toLocaleString(lang === 'en' ? 'en-US' : 'zh-TW', { hour12: false }) : t('pk.never'); }

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

async function renderAccount() {
  if (!me) return navigate('/');
  $('#who').textContent = me.displayName || me.username;
  $('#whoMeta').textContent = `@${me.username} · ${t('acct.since', fmtDate(me.createdAt))}`;
  const { passkeys, currentCredentialId } = await api('/api/passkeys');
  const list = $('#pkList');
  list.replaceChildren(...passkeys.map(pk => el('li', { class: 'pk', 'data-id': pk.id },
    el('div', { class: 'name' }, pk.name),
    el('div', { class: 'badges' },
      pk.id === currentCredentialId ? el('span', { class: 'badge cur' }, t('pk.current')) : null,
      el('span', { class: 'badge' }, pk.deviceType === 'multiDevice' ? t('pk.multiDevice') : t('pk.singleDevice')),
      pk.backupEligible ? el('span', { class: 'badge' }, t('pk.be')) : null,
      el('span', { class: 'badge' }, pk.backedUp ? t('pk.synced') : t('pk.notSynced'))),
    el('div', { class: 'meta' }, `${pk.authenticator} · AAGUID ${pk.aaguid || '-'}`),
    el('div', { class: 'meta' }, `${t('pk.created')}: ${fmtDate(pk.createdAt)} · ${t('pk.lastUsed')}: ${fmtDate(pk.lastUsedAt)}`),
    el('div', { class: 'meta' }, `${t('pk.counter')}: `, el('span', { class: 'counter' }, String(pk.counter)), ` · ${t('pk.transports')}: ${pk.transports.join(', ') || '-'} · ID ${pk.id.slice(0, 16)}...`),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'ghost', onclick: () => renamePk(pk) }, t('pk.rename')),
      el('button', { type: 'button', class: 'danger', onclick: () => deletePk(pk) }, t('pk.delete'))))));
  const { events } = await api('/api/audit?limit=30');
  $('#auditTable tbody').replaceChildren(...events.map(e => el('tr', {},
    el('td', {}, fmtDate(e.ts)), el('td', {}, e.event),
    el('td', { class: e.ok ? 'pass' : 'fail' }, e.ok ? t('audit.ok') : t('audit.fail')),
    el('td', {}, [e.detail, e.credentialId ? `cred ${e.credentialId.slice(0, 10)}...` : null].filter(Boolean).join(' · ')))));
}

async function renamePk(pk) {
  const name = prompt(t('pk.renamePrompt'), pk.name);
  if (!name) return;
  try { await api(`/api/passkeys/${pk.id}`, { method: 'PATCH', body: { name } }); showMsg('ok', t('ok.renamed')); await renderAccount(); }
  catch (err) { showMsg('error', friendlyError(err)); }
}

async function deletePk(pk) {
  if (!confirm(t('pk.deleteConfirm', pk.name))) return;
  try { await api(`/api/passkeys/${pk.id}`, { method: 'DELETE' }); showMsg('ok', t('ok.deleted')); await renderAccount(); }
  catch (err) { showMsg('error', friendlyError(err)); }
}

async function renderDebug() {
  const box = $('#debugList');
  const { ceremonies } = await api('/api/debug/ceremonies');
  if (!ceremonies.length) { box.replaceChildren(el('p', { class: 'hint' }, t('debug.empty'))); return; }
  box.replaceChildren(...ceremonies.map((c, i) => el('details', i < 2 ? { open: '' } : {},
    el('summary', {}, `${c.at} · ${c.kind}${c.ok === false ? ' · FAILED: ' + c.error : ''}`),
    c.decoded ? el('div', {}, el('h3', {}, 'decoded'), el('pre', {}, JSON.stringify(c.decoded, null, 2))) : null,
    el('h3', {}, c.options ? 'options (server -> browser)' : 'response (browser -> server)'),
    el('pre', {}, JSON.stringify(c.options || c.response, null, 2)))));
}

function currentView() {
  const p = location.pathname;
  if (p === '/account') return 'account';
  if (p === '/debug') return 'debug';
  return 'auth';
}

async function render() {
  const view = currentView();
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== `view-${view}`; });
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  try {
    if (view === 'account') await renderAccount();
    else if (view === 'debug') { if (!config?.debug) return navigate('/'); await renderDebug(); }
    else if (view === 'auth') { if (me) return navigate('/account'); startConditionalUI(); }
  } catch (err) { showMsg('error', friendlyError(err)); }
}

async function navigate(path) {
  if (location.pathname !== path) history.pushState({}, '', path + location.search);
  if (currentView() !== 'auth') WebAuthnAbortService.cancelCeremony();
  await render();
}

function checkEnvironment() {
  const warn = $('#envWarn');
  const msgs = [];
  if (!window.isSecureContext) msgs.push(t('warn.insecure', location.origin));
  else if (config && !config.origins.includes(location.origin)) msgs.push(t('warn.host', location.origin, config.origins[0]));
  if (!browserSupportsWebAuthn()) msgs.push(t('err.unsupported'));
  warn.textContent = msgs.join('\n'); warn.hidden = !msgs.length;
}

// ---------- wiring ----------
async function init() {
  const theme = store.get('pk.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
  applyI18n();
  $('#langBtn').addEventListener('click', () => { lang = lang === 'en' ? 'zh-TW' : 'en'; store.set('pk.lang', lang); applyI18n(); if (currentView() === 'account') renderAccount().catch(() => {}); });
  $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.querySelectorAll('#nav a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); clearMsg(); navigate(a.getAttribute('href')); }));
  window.addEventListener('popstate', render);

  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault();
    withBusy($('#loginBtn'), async () => afterLogin(await login($('#loginUser').value.trim())));
  });
  $('#registerForm').addEventListener('submit', e => {
    e.preventDefault();
    withBusy($('#registerBtn'), async () => {
      const r = await register($('#regUser').value.trim(), $('#regName').value.trim());
      await refreshMe();
      showMsg('ok', t('ok.registered', r.passkey.name));
      await navigate('/account');
    });
  });
  $('#addPkBtn').addEventListener('click', () => withBusy($('#addPkBtn'), async () => {
    const r = await register(undefined, undefined, $('#newPkName').value.trim());
    $('#newPkName').value = '';
    showMsg('ok', t('ok.added', r.passkey.name));
    await renderAccount();
  }));
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: {} });
    me = null; await refreshMe(); showMsg('ok', t('ok.logout')); await navigate('/');
  });
  $('#debugRefresh').addEventListener('click', () => renderDebug().catch(err => showMsg('error', friendlyError(err))));

  try {
    config = await api('/api/config');
    applyI18n();
    checkEnvironment();
    await refreshMe();
  } catch (err) { showMsg('error', friendlyError(err)); }
  await render();
  document.body.dataset.ready = '1';
}

init();
