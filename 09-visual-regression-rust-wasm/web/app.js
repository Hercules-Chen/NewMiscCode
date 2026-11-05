// app.js - browser UI: drag two PNGs, diff them with vr_core.wasm, view with slider/onion/side.
// Debug: add ?debug=1 to the URL (debug panel + console.debug); DevTools object: window.VR
import { createCore } from './vrcore.js';
import { mountViewer, VIEWER_CSS } from './viewer.js';
import { applyI18n, initialLang, makeT } from './i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const state = { lang: initialLang(), a: null, b: null, nameA: '', nameB: '', result: null, urls: [], logs: [], core: null, viewer: null };
let t = makeT(state.lang);

function log(level, msg, data) {
  const rec = { ts: new Date().toISOString(), level, msg, ...(data || {}) };
  state.logs.push(rec);
  if (state.logs.length > 500) state.logs.shift();
  if (DEBUG) {
    console.debug('[vr]', level, msg, data || '');
    const pre = $('debugLog');
    pre.textContent += JSON.stringify(rec) + '\n';
    pre.scrollTop = pre.scrollHeight;
  }
}

const style = document.createElement('style');
style.textContent = VIEWER_CSS;
document.head.appendChild(style);

function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('vr.lang', lang); } catch { /* ignore */ }
  t = applyI18n(document, lang);
  document.title = t('app.title');
  renderNames();
  renderResult();
  log('info', 'lang', { lang });
}

function renderNames() {
  for (const k of ['A', 'B']) {
    const name = state['name' + k];
    $('name' + k).textContent = name ? t('drop.loaded') + name + ` (${state['size' + k]} B)` : '';
  }
}

function setStatus(key, cls, extra = '') {
  const s = $('status');
  s.textContent = (key ? t(key) : '') + extra;
  s.className = 'status' + (cls ? ' ' + cls : '');
  s.dataset.key = key || '';
}

async function readFile(file, which) {
  if (!file) return;
  if (!/\.png$/i.test(file.name) && file.type !== 'image/png') { setStatus('err.png', 'bad'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  setInput(which, bytes, file.name);
}

function setInput(which, bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  state.urls.push(url);
  state[which] = bytes;
  state[which === 'a' ? 'nameA' : 'nameB'] = name;
  const suffix = which === 'a' ? 'A' : 'B';
  state['size' + suffix] = bytes.length;
  renderNames();
  const img = $('thumb' + suffix);
  img.src = url;
  img.hidden = false;
  log('info', 'file loaded', { which, name, bytes: bytes.length });
  if (state.a && state.b) compare();
}

function options() {
  const ignore = $('ignore').value.split(';').map(s => s.trim()).filter(Boolean).map(s => s.split(',').map(Number))
    .filter(n => n.length === 4 && n.every(v => Number.isFinite(v) && v >= 0));
  return { threshold: Number($('threshold').value), includeAA: $('includeAA').checked, gap: Number($('gap').value) || 0, ignore };
}

async function compare() {
  if (!state.a || !state.b) { setStatus('stats.none'); return null; }
  if (!state.core) return null;
  const opts = options();
  try {
    const { stats, diffPng, ms } = await state.core.compare(state.a, state.b, opts, { render: true });
    const url = URL.createObjectURL(new Blob([diffPng], { type: 'image/png' }));
    state.urls.push(url);
    state.result = { stats, ms, diffUrl: url, baseUrl: $('thumbA').src, curUrl: $('thumbB').src };
    log('info', 'compare', { ms: Math.round(ms * 100) / 100, diffPixels: stats.diffPixels, boxes: stats.boxes.length, opts });
    renderResult();
    return stats;
  } catch (err) {
    log('error', 'compare failed', { error: err.message });
    setStatus('', 'bad', err.message);
    return null;
  }
}

function renderResult() {
  const r = state.result;
  if (!r) { setStatus(state.core ? 'stats.none' : '', ''); return; }
  const s = r.stats;
  setStatus(s.diffPixels > 0 ? 'stats.changed' : 'stats.same', s.diffPixels > 0 ? 'bad' : 'good', s.sizeMismatch ? ' ' + t('stats.mismatch') : '');
  $('stats').hidden = false;
  $('sDiff').textContent = s.diffPixels.toLocaleString('en-US');
  $('sPct').textContent = s.percent + '%';
  $('sBoxes').textContent = String(s.boxes.length);
  $('sAA').textContent = s.aaPixels.toLocaleString('en-US');
  $('sSize').textContent = `${s.width} x ${s.height}`;
  $('sTime').textContent = r.ms.toFixed(1) + ' ms';
  const dl = $('downloadLink');
  dl.href = r.diffUrl;
  dl.hidden = false;
  $('boxList').hidden = s.boxes.length === 0;
  $('boxItems').innerHTML = s.boxes.map(b => `<li>x=${b.x} y=${b.y} w=${b.w} h=${b.h} (${b.pixels} px)</li>`).join('');
  const prevMode = state.viewer ? state.viewer.mode : 'slider';
  state.viewer = mountViewer($('viewer'), { baseline: r.baseUrl, current: r.curUrl, diff: r.diffUrl, boxes: s.boxes, width: s.width, height: s.height, mode: prevMode, t });
}

function wireDrop(label, input, which) {
  input.addEventListener('change', () => readFile(input.files[0], which));
  ['dragenter', 'dragover'].forEach(ev => label.addEventListener(ev, e => { e.preventDefault(); label.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => label.addEventListener(ev, e => { e.preventDefault(); label.classList.remove('over'); }));
  label.addEventListener('drop', e => readFile(e.dataTransfer.files[0], which));
}

async function loadSample() {
  const get = async (p) => new Uint8Array(await (await fetch(p)).arrayBuffer());
  setInput('a', await get('../test/fixtures/base.png'), 'base.png');
  setInput('b', await get('../test/fixtures/current.png'), 'current.png');
}

async function init() {
  t = applyI18n(document, state.lang);
  document.title = t('app.title');
  if (DEBUG) $('debugPanel').hidden = false;
  wireDrop($('dropA'), $('fileA'), 'a');
  wireDrop($('dropB'), $('fileB'), 'b');
  $('langBtn').addEventListener('click', () => setLang(state.lang === 'zh-TW' ? 'en' : 'zh-TW'));
  $('compareBtn').addEventListener('click', () => compare());
  $('sampleBtn').addEventListener('click', () => loadSample().catch(e => log('error', 'sample failed', { error: e.message })));
  $('threshold').addEventListener('input', () => { $('thrOut').textContent = Number($('threshold').value).toFixed(2); });
  $('threshold').addEventListener('change', () => compare());
  $('includeAA').addEventListener('change', () => compare());
  try {
    const t0 = performance.now();
    const res = await fetch('vr_core.wasm');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.core = await createCore(await res.arrayBuffer());
    $('ver').textContent = state.core.version;
    log('info', 'wasm ready', { version: state.core.version, ms: Math.round(performance.now() - t0) });
    setStatus('stats.none');
    document.body.dataset.ready = '1';
  } catch (err) {
    log('error', 'wasm load failed', { error: err.message });
    setStatus('err.wasm', 'bad', err.message + (location.protocol === 'file:' ? ' (file:// - use: node src/cli.js serve)' : ''));
  }
}

// DevTools handle: VR.state, VR.compare(), VR.setLang('en'), VR.logs, VR.core.compare(aBytes, bBytes, opts)
window.VR = { state, compare, setLang, get logs() { return state.logs; }, get core() { return state.core; }, debug: DEBUG };
init();
