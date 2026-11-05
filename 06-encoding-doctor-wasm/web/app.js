// 編碼醫生 Encoding Doctor - browser UI. All analysis runs in Go WebAssembly
// (encdoc.wasm, exposed as window.encdoc). This file only handles the UI.
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);
  const MAX_FILE = 20 * 1024 * 1024;
  const SKIP_DIRS = new Set(['.git', 'node_modules']);

  const I18N = {
    zh: {
      title: '編碼醫生', subtitle: 'Encoding Doctor', themeAuto: '主題：自動', themeLight: '淺色', themeDark: '深色', debug: '除錯',
      dropHint: '把檔案或資料夾拖放到這裡（檔案不會上傳，全部在瀏覽器內以 Go WebAssembly 分析）',
      pickFiles: '選擇檔案', pickFolder: '選擇資料夾', optForceAscii: '.bat 非 ASCII 換成 ?（--force-ascii）', optLossy: '允許有損的亂碼還原（--allow-lossy）',
      fixAll: '全部修復並下載 ZIP', clear: '清除', colFile: '檔案', colEncoding: '編碼（信心度）', colEol: '換行', colIssues: '問題', colActions: '動作',
      close: '關閉', decodeAs: '以此編碼顯示', decoded: '解碼結果', repaired: '亂碼還原後', convert: '轉換並下載', to: '目標', eol: '換行', keep: '不變', download: '下載',
      debugLog: '除錯記錄', debugHint: 'DevTools 主控台可用 window.encdocApp 與 window.encdoc。網址加上 ?debug=1 會同時輸出 console.debug。',
      footer: '規則：.bat/.cmd → ASCII + CRLF；.ps1 → 有中文時 UTF-8 with BOM；.md/.json/.js/.html → UTF-8 無 BOM。',
      loading: '載入 WebAssembly 中…', ready: (v, mb, ms) => `就緒：encdoc ${v}（wasm ${mb} MB，載入 ${ms} ms）`, loadFail: e => `WebAssembly 載入失敗：${e}`,
      summary: (n, e, w, f) => `共 ${n} 個檔案：錯誤 ${e}、警告 ${w}、可自動修復 ${f}`,
      ok: '正常', preview: '預覽', fixDl: '修復下載', noFix: '無可修復', binary: '二進位', none: '無', mixed: '混用',
      policy: { bat: '批次檔規則', ps1: 'PowerShell 規則', 'utf8-nobom': 'UTF-8 無 BOM 規則', sh: 'Shell 規則', text: '一般文字', '': '未知類型' },
      invalid: n => `${n} 個無法解碼`, nothingChanged: '沒有需要修改的內容', fixedN: n => `已修復 ${n} 個檔案，下載 ZIP`, lost: n => `注意：${n} 個字元無法表示，已換成 ?`,
      skipped: (n) => `略過 ${n} 個非文字或過大的檔案`, cands: '候選編碼：'
    },
    en: {
      title: 'Encoding Doctor', subtitle: '編碼醫生', themeAuto: 'Theme: auto', themeLight: 'Light', themeDark: 'Dark', debug: 'Debug',
      dropHint: 'Drop files or folders here (nothing is uploaded; everything is analyzed in the browser by Go WebAssembly)',
      pickFiles: 'Choose files', pickFolder: 'Choose folder', optForceAscii: 'Replace non-ASCII in .bat with ? (--force-ascii)', optLossy: 'Allow lossy mojibake repair (--allow-lossy)',
      fixAll: 'Fix all & download ZIP', clear: 'Clear', colFile: 'File', colEncoding: 'Encoding (confidence)', colEol: 'EOL', colIssues: 'Issues', colActions: 'Actions',
      close: 'Close', decodeAs: 'Decode as', decoded: 'Decoded text', repaired: 'After mojibake repair', convert: 'Convert & download', to: 'Target', eol: 'EOL', keep: 'keep', download: 'Download',
      debugLog: 'Debug log', debugHint: 'In DevTools use window.encdocApp and window.encdoc. Add ?debug=1 to also log to console.debug.',
      footer: 'Rules: .bat/.cmd → ASCII + CRLF; .ps1 → UTF-8 with BOM when non-ASCII; .md/.json/.js/.html → UTF-8 without BOM.',
      loading: 'Loading WebAssembly…', ready: (v, mb, ms) => `Ready: encdoc ${v} (wasm ${mb} MB, loaded in ${ms} ms)`, loadFail: e => `WebAssembly failed to load: ${e}`,
      summary: (n, e, w, f) => `${n} files: ${e} errors, ${w} warnings, ${f} auto-fixable`,
      ok: 'OK', preview: 'Preview', fixDl: 'Fix & download', noFix: 'Nothing to fix', binary: 'binary', none: 'none', mixed: 'mixed',
      policy: { bat: 'batch rule', ps1: 'PowerShell rule', 'utf8-nobom': 'UTF-8 no-BOM rule', sh: 'shell rule', text: 'plain text', '': 'unknown type' },
      invalid: n => `${n} undecodable`, nothingChanged: 'Nothing to change', fixedN: n => `Fixed ${n} files, downloading ZIP`, lost: n => `Note: ${n} characters not representable, replaced by ?`,
      skipped: n => `Skipped ${n} non-text or too large files`, cands: 'Candidates:'
    }
  };

  const state = { lang: 'zh', files: [], log: [], debug: qs.get('debug') === '1', ready: false, current: null };
  const t = k => I18N[state.lang][k];

  function log(event, data) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    state.log.push(entry);
    if (state.log.length > 2000) state.log.shift();
    if (state.debug) console.debug('[encdoc]', event, data || '');
    const el = $('debugLog');
    if (el && !$('debugPanel').hidden) el.textContent = state.log.slice(-300).map(e => JSON.stringify(e)).join('\n');
  }

  // ---------- i18n / theme ----------
  function applyLang(lang) {
    state.lang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-TW' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
    $('langBtn').textContent = lang === 'zh' ? 'EN' : '中文';
    document.title = lang === 'zh' ? '編碼醫生 Encoding Doctor' : 'Encoding Doctor 編碼醫生';
    try { localStorage.setItem('encdoc.lang', lang); } catch { /* ignore */ }
    updateStatus();
    render();
    if (state.current) showPreview(state.current);
    log('lang', { lang });
  }
  function applyTheme(v) {
    if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
    $('themeSel').value = v;
    try { localStorage.setItem('encdoc.theme', v); } catch { /* ignore */ }
  }

  // ---------- wasm ----------
  let wasmInfo = null;
  async function loadWasm() {
    const t0 = performance.now();
    const go = new Go();
    const ready = new Promise(res => { window.__encdocReady = res; });
    const resp = await fetch('encdoc.wasm');
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' encdoc.wasm (run: npm run build)');
    let result;
    if (WebAssembly.instantiateStreaming && (resp.headers.get('content-type') || '').includes('application/wasm')) {
      result = await WebAssembly.instantiateStreaming(resp, go.importObject);
    } else {
      result = await WebAssembly.instantiate(await resp.arrayBuffer(), go.importObject);
    }
    go.run(result.instance).then(() => log('wasm-exit', {}));
    await ready;
    const bytes = Number(resp.headers.get('content-length')) || 0;
    wasmInfo = { version: window.encdoc.version, mb: (bytes / 1048576).toFixed(1), ms: Math.round(performance.now() - t0) };
    state.ready = true;
    log('wasm-ready', wasmInfo);
    fillEncodingSelects();
  }
  function updateStatus(err) {
    const s = $('status');
    if (err) { s.dataset.state = 'error'; s.textContent = t('loadFail')(err); s.className = 'sev-error'; return; }
    if (!state.ready) { s.dataset.state = 'loading'; s.textContent = t('loading'); return; }
    s.dataset.state = 'ready'; s.className = 'muted';
    s.textContent = t('ready')(wasmInfo.version, wasmInfo.mb, wasmInfo.ms);
  }
  function fillEncodingSelects() {
    const encs = Array.from(window.encdoc.encodings);
    $('pvEnc').innerHTML = '<option value="auto">auto</option>' + encs.map(e => `<option value="${e}">${e}</option>`).join('');
    $('cvTo').innerHTML = encs.map(e => `<option value="${e}">${e}</option>`).join('');
  }
  function options() {
    return { forceAscii: $('optForceAscii').checked, allowLossy: $('optLossy').checked };
  }

  // ---------- file intake ----------
  async function addFiles(list, fromFolder) {
    let skipped = 0;
    for (const { file, path } of list) {
      if (file.size > MAX_FILE || (fromFolder && !window.encdoc.policy(path))) { skipped++; continue; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const existing = state.files.findIndex(f => f.path === path);
      const entry = { path, name: file.name, bytes, report: null };
      analyzeEntry(entry);
      if (existing >= 0) state.files[existing] = entry; else state.files.push(entry);
    }
    if (skipped) log('skipped', { count: skipped });
    state.skipped = (state.skipped || 0) + skipped;
    render();
  }
  function analyzeEntry(entry) {
    const t0 = performance.now();
    const json = window.encdoc.analyze(entry.path, entry.bytes, JSON.stringify(options()));
    if (typeof json !== 'string') { log('analyze-error', { path: entry.path, error: json && json.error }); return; }
    entry.report = JSON.parse(json);
    log('analyze', { path: entry.path, size: entry.bytes.length, encoding: entry.report.encoding, confidence: entry.report.confidence, issues: entry.report.issues.map(i => i.code), ms: Math.round(performance.now() - t0) });
  }
  function readEntry(entry, prefix) {
    return new Promise(resolve => {
      if (entry.isFile) { entry.file(f => resolve([{ file: f, path: prefix + f.name }]), () => resolve([])); return; }
      if (!entry.isDirectory || SKIP_DIRS.has(entry.name)) { resolve([]); return; }
      const reader = entry.createReader(); const all = [];
      const next = () => reader.readEntries(async ents => {
        if (!ents.length) { const nested = await Promise.all(all.map(e => readEntry(e, prefix + entry.name + '/'))); resolve(nested.flat()); return; }
        all.push(...ents); next();
      }, () => resolve([]));
      next();
    });
  }

  // ---------- rendering ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render() {
    const rows = $('rows');
    const has = state.files.length > 0;
    $('results').hidden = !has; $('summary').hidden = !has;
    if (!has) { rows.innerHTML = ''; return; }
    let e = 0, w = 0, f = 0;
    rows.innerHTML = state.files.map((file, idx) => {
      const r = file.report;
      if (!r) return '';
      e += r.errors; w += r.warnings; f += r.fixable;
      const L = state.lang;
      const sev = r.errors ? 'error' : r.warnings ? 'warning' : 'ok';
      const issues = r.issues.length
        ? r.issues.map(i => `<div class="issue sev-${i.severity}" data-code="${i.code}"><span class="badge">${esc(i.code)}</span>${esc(i.message[L])}<div class="fix">→ ${esc(i.fix[L])}</div></div>`).join('')
        : `<span class="badge sev-ok">${t('ok')}</span>`;
      const pct = Math.round(r.confidence * 100);
      const enc = r.encoding === 'binary' ? t('binary') : r.encoding;
      const eolTxt = r.eol.style === 'mixed' ? `${t('mixed')} (CRLF ${r.eol.crlf}/LF ${r.eol.lf})` : r.eol.style.toUpperCase();
      return `<tr data-file="${esc(file.path)}" data-encoding="${r.encoding}" data-sev="${sev}">
        <td class="file" data-label="${t('colFile')}"><b>${esc(file.path)}</b><div class="muted small">${t('policy')[r.policy] || r.policy} · ${r.size} B</div></td>
        <td data-label="${t('colEncoding')}"><span class="enc">${esc(enc)}</span> ${pct}%<span class="conf"><i style="width:${pct}%"></i></span>${r.invalidSequences ? `<div class="sev-warning small">${t('invalid')(r.invalidSequences)}</div>` : ''}</td>
        <td data-label="BOM" class="bom">${r.bom || '-'}</td>
        <td data-label="${t('colEol')}">${eolTxt}</td>
        <td data-label="${t('colIssues')}" class="sev-${sev}">${issues}</td>
        <td data-label="${t('colActions')}"><span class="row"><button type="button" data-act="preview" data-idx="${idx}">${t('preview')}</button>${r.fixable ? `<button type="button" class="primary" data-act="fix" data-idx="${idx}">${t('fixDl')}</button>` : ''}</span></td>
      </tr>`;
    }).join('');
    $('sumText').textContent = t('summary')(state.files.length, e, w, f) + (state.skipped ? ' · ' + t('skipped')(state.skipped) : '');
    $('fixAllBtn').disabled = f === 0;
  }

  function showPreview(idx, enc) {
    const file = state.files[idx];
    if (!file) return;
    state.current = idx;
    const r = file.report;
    $('preview').hidden = false;
    $('pvTitle').textContent = file.path;
    const sel = $('pvEnc');
    sel.value = enc || sel.value || 'auto';
    const d = window.encdoc.decode(file.bytes, sel.value);
    $('pvText').textContent = d.error ? d.error : d.text.slice(0, 20000);
    $('pvInfo').textContent = d.error ? '' : `${d.encoding}${d.bom ? ' + BOM' : ''} · ${d.invalid ? t('invalid')(d.invalid) : 'OK'}`;
    $('pvCands').innerHTML = `<b>${t('cands')}</b>` + (r.candidates || []).map(c => `<span title="${esc(c.sample)}">${c.encoding} ${Math.round(c.confidence * 100)}%</span>`).join('');
    const hasFix = !!r.previewFixed;
    $('pvFixedBox').hidden = !hasFix;
    $('pvFixed').textContent = hasFix ? r.previewFixed : '';
    document.querySelector('.grid2').classList.toggle('single', !hasFix);
    if (!$('cvTo').dataset.touched) $('cvTo').value = 'utf-8';
    log('preview', { path: file.path, decodeAs: sel.value, invalid: d.invalid });
  }

  function download(name, bytes, type) {
    const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.split('/').pop();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    log('download', { name: a.download, bytes: bytes.length });
  }

  function fixOne(idx) {
    const file = state.files[idx];
    const res = window.encdoc.fix(file.path, file.bytes, JSON.stringify(options()));
    if (res.error) { log('fix-error', { error: res.error }); return; }
    const info = JSON.parse(res.json);
    log('fix', { path: file.path, changed: info.changed, actions: info.actions.map(a => a.code), errorsAfter: info.after.errors, lost: info.lost });
    if (!info.changed) { alert(t('nothingChanged')); return; }
    if (info.lost) log('fix-lost', { msg: t('lost')(info.lost) });
    download(file.name, res.bytes);
  }

  function fixAll() {
    const names = [], datas = [];
    for (const file of state.files) {
      if (!file.report || !file.report.fixable) continue;
      const res = window.encdoc.fix(file.path, file.bytes, JSON.stringify(options()));
      if (res.error) continue;
      const info = JSON.parse(res.json);
      if (info.changed) { names.push(file.path); datas.push(res.bytes); }
    }
    log('fix-all', { files: names });
    if (!names.length) { alert(t('nothingChanged')); return; }
    const zip = window.encdoc.zip(names, datas);
    if (zip.error) { log('zip-error', { error: zip.error }); return; }
    download('encdoc-fixed.zip', zip, 'application/zip');
  }

  function convertCurrent() {
    const file = state.files[state.current];
    if (!file) return;
    const o = { from: $('pvEnc').value, to: $('cvTo').value, bom: $('cvBom').checked, eol: $('cvEol').value };
    const res = window.encdoc.convert(file.bytes, JSON.stringify(o));
    log('convert', { path: file.path, ...o, lost: res.lost, error: res.error });
    if (res.error) { alert(res.error); return; }
    if (res.lost) alert(t('lost')(res.lost));
    download(file.name, res.bytes);
  }

  // ---------- events ----------
  function bind() {
    $('langBtn').onclick = () => applyLang(state.lang === 'zh' ? 'en' : 'zh');
    $('themeSel').onchange = e => applyTheme(e.target.value);
    $('debugBtn').onclick = () => { $('debugPanel').hidden = !$('debugPanel').hidden; log('debug-panel', { open: !$('debugPanel').hidden }); };
    $('dbgClear').onclick = () => { state.log = []; $('debugLog').textContent = ''; };
    $('fileInput').onchange = e => { addFiles(Array.from(e.target.files).map(f => ({ file: f, path: f.name })), false); e.target.value = ''; };
    $('dirInput').onchange = e => { addFiles(Array.from(e.target.files).filter(f => !f.webkitRelativePath.split('/').some(p => SKIP_DIRS.has(p))).map(f => ({ file: f, path: f.webkitRelativePath || f.name })), true); e.target.value = ''; };
    const drop = $('drop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('over');
      const items = Array.from(e.dataTransfer.items || []).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      if (items.length) {
        const hasDir = items.some(i => i.isDirectory);
        const lists = await Promise.all(items.map(i => readEntry(i, '')));
        addFiles(lists.flat(), hasDir);
      } else {
        addFiles(Array.from(e.dataTransfer.files).map(f => ({ file: f, path: f.name })), false);
      }
    });
    $('rows').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const idx = Number(b.dataset.idx);
      if (b.dataset.act === 'preview') { $('pvEnc').value = 'auto'; showPreview(idx); $('preview').scrollIntoView({ behavior: 'smooth' }); }
      if (b.dataset.act === 'fix') fixOne(idx);
    });
    $('pvEnc').onchange = () => showPreview(state.current, $('pvEnc').value);
    $('pvClose').onclick = () => { $('preview').hidden = true; state.current = null; };
    $('cvTo').onchange = () => { $('cvTo').dataset.touched = '1'; };
    $('cvBtn').onclick = convertCurrent;
    $('fixAllBtn').onclick = fixAll;
    $('clearBtn').onclick = () => { state.files = []; state.skipped = 0; $('preview').hidden = true; state.current = null; render(); log('clear', {}); };
    for (const id of ['optForceAscii', 'optLossy']) $(id).onchange = () => { state.files.forEach(analyzeEntry); render(); };
  }

  // ---------- start ----------
  window.encdocApp = { state, log, analyzeEntry, render, I18N, get files() { return state.files; } };
  let lang = 'zh', theme = 'auto';
  try { lang = qs.get('lang') || localStorage.getItem('encdoc.lang') || 'zh'; theme = localStorage.getItem('encdoc.theme') || 'auto'; } catch { /* ignore */ }
  if (qs.get('lang')) lang = qs.get('lang');
  bind();
  applyTheme(theme);
  applyLang(lang === 'en' ? 'en' : 'zh');
  if (state.debug) $('debugPanel').hidden = false;
  loadWasm().then(updateStatus).catch(err => { log('wasm-error', { error: String(err && err.message || err) }); updateStatus(String(err && err.message || err)); });
})();
