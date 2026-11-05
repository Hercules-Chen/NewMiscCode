/*
 * DuckDB-WASM Data Desk - main application (classic script, async throughout).
 * Depends on globals: duckdb (IIFE bundle), I18N, SampleGen, MiniChart.
 * Runtime config: window.DDB_CONFIG = { mode: 'local' | 'cdn', duckdbVersion, xlsxUrl }
 */
(function () {
  'use strict';
  const { t } = I18N;
  const CFG = Object.assign({ mode: 'local', duckdbVersion: '1.32.0', xlsxVersion: '0.18.5' }, window.DDB_CONFIG || {});
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1';
  const $ = (sel) => document.querySelector(sel);

  // ---------------------------------------------------------------- storage helpers
  function lsGet(key, dflt) { try { const v = localStorage.getItem(key); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------- debug log
  const debugEntries = [];
  window.__ddbDebug = debugEntries; // inspectable from DevTools / tests
  function dlog(kind, msg, extra) {
    const entry = { ts: new Date().toISOString(), kind, msg: String(msg), ...(extra || {}) };
    debugEntries.push(entry);
    if (debugEntries.length > 2000) debugEntries.shift();
    if (DEBUG) console.debug('[ddb]', kind, msg, extra || '');
    const list = $('#debugList');
    if (list) {
      const li = document.createElement('li');
      li.className = 'dbg-' + kind;
      const ms = entry.ms != null ? ` (${entry.ms} ms)` : '';
      li.textContent = `${entry.ts.slice(11, 23)} [${kind}] ${entry.msg}${ms}${entry.rows != null ? ' rows=' + entry.rows : ''}`;
      list.appendChild(li);
      while (list.childNodes.length > 500) list.removeChild(list.firstChild);
      list.scrollTop = list.scrollHeight;
    }
  }
  window.addEventListener('error', (e) => dlog('error', 'window.error: ' + (e.message || e)));
  window.addEventListener('unhandledrejection', (e) => dlog('error', 'unhandledrejection: ' + ((e.reason && e.reason.message) || e.reason)));

  // ---------------------------------------------------------------- state
  const state = {
    db: null,
    conn: null,
    tables: [],
    result: null, // { columns:[{name,type}], table: arrow.Table, rowCount, ms, sql }
    page: 0,
    pageSize: lsGet('ddb.pageSize', 50),
    history: lsGet('ddb.history', []),
    theme: lsGet('ddb.theme', 'auto'),
    view: 'table',
    seq: 0 // incremented after every user query (handy for automation)
  };

  // ---------------------------------------------------------------- DuckDB init
  function abs(u) { return new URL(u, location.href).href; }
  function bundles() {
    if (CFG.mode === 'cdn') {
      const base = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${CFG.duckdbVersion}/dist/`;
      return {
        mvp: { mainModule: base + 'duckdb-mvp.wasm', mainWorker: base + 'duckdb-browser-mvp.worker.js' },
        eh: { mainModule: base + 'duckdb-eh.wasm', mainWorker: base + 'duckdb-browser-eh.worker.js' }
      };
    }
    return {
      mvp: { mainModule: abs('vendor/duckdb-mvp.wasm'), mainWorker: abs('vendor/duckdb-browser-mvp.worker.js') },
      eh: { mainModule: abs('vendor/duckdb-eh.wasm'), mainWorker: abs('vendor/duckdb-browser-eh.worker.js') }
    };
  }

  async function initDuckDB() {
    const t0 = performance.now();
    setStatus('loading', t('statusLoading'));
    const bundle = await duckdb.selectBundle(bundles());
    dlog('init', 'selected bundle ' + bundle.mainModule);
    // Same code path for same-origin and CDN: a tiny blob worker that importScripts() the real worker.
    const workerUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const logger = {
      log(entry) {
        if (DEBUG) console.debug('[duckdb]', entry);
      }
    };
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
    const conn = await db.connect();
    state.db = db;
    state.conn = conn;
    const ver = await db.getVersion();
    const ms = Math.round(performance.now() - t0);
    dlog('init', 'DuckDB ready, version ' + ver, { ms });
    $('#ddbVersion').textContent = 'DuckDB ' + ver + ' / duckdb-wasm ' + CFG.duckdbVersion;
    setStatus('ready', t('statusReady'));
  }

  // ---------------------------------------------------------------- status / UI helpers
  function setStatus(kind, text) {
    const s = $('#status');
    s.dataset.state = kind;
    s.textContent = text;
  }
  function toast(msg, isErr) {
    const box = $('#messages');
    const div = document.createElement('div');
    div.className = 'msg' + (isErr ? ' msg-err' : '');
    div.textContent = msg;
    box.prepend(div);
    while (box.childNodes.length > 5) box.removeChild(box.lastChild);
  }
  function quoteIdent(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
  function quoteStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function tableNameFor(fileName) {
    let base = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'table';
    if (/^[0-9]/.test(base)) base = 't_' + base;
    return base;
  }

  // ---------------------------------------------------------------- query execution
  async function rawQuery(sql, tag) {
    const t0 = performance.now();
    try {
      const res = await state.conn.query(sql);
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      dlog('query', (tag ? '[' + tag + '] ' : '') + sql.replace(/\s+/g, ' ').slice(0, 300), { ms, rows: res.numRows });
      return res;
    } catch (e) {
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      dlog('error', (tag ? '[' + tag + '] ' : '') + (e.message || e) + ' | SQL: ' + sql.replace(/\s+/g, ' ').slice(0, 300), { ms });
      throw e;
    }
  }

  async function runUserQuery(sql) {
    sql = (sql || '').trim();
    if (!sql || !state.conn) return null;
    setStatus('running', t('statusRunning'));
    $('#runBtn').disabled = true;
    const t0 = performance.now();
    try {
      const table = await rawQuery(sql, 'user');
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      const columns = table.schema.fields.map((f) => ({ name: f.name, type: String(f.type), typeId: f.type.typeId }));
      state.result = { columns, table, rowCount: table.numRows, ms, sql };
      state.page = 0;
      addHistory(sql, table.numRows, ms);
      renderResult();
      setupChartControls();
      if (state.view === 'chart') drawChart();
      setStatus('ready', t('statusReady'));
      if (/^\s*(create|drop|alter|insert|copy|attach)\b/i.test(sql)) await refreshSchema();
      return state.result;
    } catch (e) {
      setStatus('error', t('statusError'));
      showError(e.message || String(e));
      return null;
    } finally {
      $('#runBtn').disabled = false;
      state.seq++;
    }
  }

  function showError(msg) {
    state.result = null;
    $('#resultMeta').hidden = true;
    const grid = $('#grid');
    grid.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'err';
    pre.id = 'queryError';
    pre.textContent = msg;
    grid.appendChild(pre);
    $('#pager').hidden = true;
    $('#exportBtn').disabled = true;
  }

  // ---------------------------------------------------------------- value formatting
  // Arrow type ids: Date=8, Time=9, Timestamp=10
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d, withTime) {
    const s = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    if (!withTime) return s;
    const ms = d.getUTCMilliseconds();
    return s + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + (ms ? '.' + String(ms).padStart(3, '0') : '');
  }
  function fmtValue(v, col) {
    if (v == null) return null;
    if (col.typeId === 10 || col.typeId === 8) {
      const d = v instanceof Date ? v : new Date(Number(v));
      if (!isNaN(d.getTime())) return fmtDate(d, col.typeId === 10);
    }
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    if (v instanceof Date) return fmtDate(v, true);
    if (typeof v === 'object') {
      try { return JSON.stringify(v.toJSON ? v.toJSON() : v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)); } catch (e) { return String(v); }
    }
    return String(v);
  }
  function getCell(r, c) {
    const col = state.result.table.getChildAt(c);
    return col ? col.get(r) : null;
  }

  // ---------------------------------------------------------------- result grid with paging
  function renderResult() {
    const res = state.result;
    const grid = $('#grid');
    grid.innerHTML = '';
    if (!res) { grid.innerHTML = '<p class="muted">' + t('noResult') + '</p>'; return; }
    $('#resultMeta').hidden = false;
    $('#rowCount').textContent = res.rowCount.toLocaleString();
    $('#rowCount').dataset.rows = String(res.rowCount);
    $('#queryTime').textContent = res.ms + ' ms';
    $('#exportBtn').disabled = res.rowCount === 0;
    if (res.rowCount === 0) {
      grid.innerHTML = '<p class="muted" id="noRows">' + t('noRows') + '</p>';
      $('#pager').hidden = true;
      return;
    }
    const pages = Math.max(1, Math.ceil(res.rowCount / state.pageSize));
    if (state.page >= pages) state.page = pages - 1;
    const start = state.page * state.pageSize;
    const end = Math.min(res.rowCount, start + state.pageSize);
    const tbl = document.createElement('table');
    tbl.className = 'grid';
    tbl.id = 'resultTable';
    const thead = tbl.createTHead();
    const hr = thead.insertRow();
    const th0 = document.createElement('th'); th0.textContent = '#'; th0.className = 'rownum'; hr.appendChild(th0);
    res.columns.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c.name;
      th.title = c.type;
      hr.appendChild(th);
    });
    const tb = tbl.createTBody();
    for (let r = start; r < end; r++) {
      const tr = tb.insertRow();
      const td0 = tr.insertCell(); td0.textContent = String(r + 1); td0.className = 'rownum';
      res.columns.forEach((col, c) => {
        const td = tr.insertCell();
        const v = fmtValue(getCell(r, c), col);
        if (v == null) { td.textContent = 'NULL'; td.className = 'null'; } else td.textContent = v;
        if (typeof getCell(r, c) === 'number') td.classList.add('num');
      });
    }
    grid.appendChild(tbl);
    const pager = $('#pager');
    pager.hidden = pages <= 1 && res.rowCount <= 10;
    $('#pageInfo').textContent = `${t('page')} ${state.page + 1} / ${pages} (${start + 1}-${end})`;
    $('#prevBtn').disabled = state.page === 0;
    $('#nextBtn').disabled = state.page >= pages - 1;
  }

  // ---------------------------------------------------------------- charts
  function isNumericCol(c) {
    const s = c.type.toLowerCase();
    return /^(int|uint|float|double|decimal)/.test(s) || c.typeId === 2 || c.typeId === 3 || c.typeId === 7;
  }
  function setupChartControls() {
    const res = state.result;
    const xs = $('#chartX');
    const ys = $('#chartY');
    xs.innerHTML = ''; ys.innerHTML = '';
    if (!res) return;
    res.columns.forEach((c, i) => {
      xs.add(new Option(c.name, String(i)));
      if (isNumericCol(c)) ys.add(new Option(c.name, String(i)));
    });
    const hint = state.chartHint;
    state.chartHint = null;
    const firstNum = res.columns.findIndex((c, i) => i > 0 && isNumericCol(c));
    if (hint && hint.x != null) xs.value = String(res.columns.findIndex((c) => c.name === hint.x));
    else xs.value = '0';
    if (hint && hint.y) ys.value = String(res.columns.findIndex((c) => c.name === hint.y));
    else if (firstNum >= 0) ys.value = String(firstNum);
    if (hint && hint.type) $('#chartType').value = hint.type;
  }
  function drawChart() {
    const res = state.result;
    const box = $('#chartBox');
    const note = $('#chartNote');
    note.textContent = '';
    box.innerHTML = '';
    if (!res || res.rowCount === 0) { box.innerHTML = '<p class="muted">' + t('noResult') + '</p>'; return; }
    const yi = parseInt($('#chartY').value, 10);
    const xi = parseInt($('#chartX').value, 10);
    if (isNaN(yi)) { box.innerHTML = '<p class="muted">' + t('chartNoNumeric') + '</p>'; return; }
    const limit = 500;
    const n = Math.min(res.rowCount, limit);
    if (res.rowCount > limit) note.textContent = t('chartTruncated', { n: limit });
    const labels = []; const values = [];
    for (let r = 0; r < n; r++) {
      let lv = fmtValue(getCell(r, xi), res.columns[xi]);
      // compact timestamp labels: "2026-11-01 08:00:00" -> "11-01 08:00"
      if (lv != null && res.columns[xi].typeId === 10) lv = lv.replace(/^\d{4}-/, '').replace(/:00(\.\d+)?$/, '');
      labels.push(lv == null ? 'NULL' : lv);
      const v = Number(getCell(r, yi));
      values.push(isFinite(v) ? v : 0);
    }
    const t0 = performance.now();
    MiniChart.render(box, { type: $('#chartType').value, labels, values, xName: res.columns[xi].name, yName: res.columns[yi].name });
    dlog('chart', `${$('#chartType').value} x=${res.columns[xi].name} y=${res.columns[yi].name} points=${n}`, { ms: Math.round(performance.now() - t0) });
  }
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $('#tablePane').hidden = v !== 'table';
    $('#chartPane').hidden = v !== 'chart';
    if (v === 'chart') drawChart();
  }

  // ---------------------------------------------------------------- CSV export
  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv() {
    const res = state.result;
    const lines = [res.columns.map((c) => csvCell(c.name)).join(',')];
    for (let r = 0; r < res.rowCount; r++) {
      lines.push(res.columns.map((col, c) => csvCell(fmtValue(getCell(r, c), col))).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }
  function exportCsv() {
    if (!state.result) return;
    const bom = $('#bomChk').checked ? '\uFEFF' : '';
    const blob = new Blob([bom + buildCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    a.download = 'query-result-' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    dlog('export', 'CSV ' + a.download, { rows: state.result.rowCount });
    toast(t('exported', { n: state.result.rowCount }));
  }

  // ---------------------------------------------------------------- file loading
  let xlsxPromise = null;
  function loadXlsxLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CFG.mode === 'cdn' ? `https://cdn.jsdelivr.net/npm/xlsx@${CFG.xlsxVersion}/dist/xlsx.full.min.js` : 'vendor/xlsx.full.min.js';
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxPromise = null; reject(new Error('Failed to load SheetJS from ' + s.src)); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  // DuckDB-WASM >= 1.29 does not statically link the json/parquet extensions; they are
  // auto-downloaded from extensions.duckdb.org on first use. To work offline (and inside
  // sandboxed hosts such as claude.ai Artifacts), JSON/JSONL is parsed in JS and converted
  // to CSV, which DuckDB core reads with full type sniffing (timestamps, numbers).
  function parseJsonRecords(text) {
    const s = text.replace(/^\uFEFF/, '').trim();
    if (!s) return [];
    if (s[0] === '[') return JSON.parse(s);
    try {
      const obj = JSON.parse(s);
      if (Array.isArray(obj)) return obj;
      if (obj && typeof obj === 'object') {
        const arrKey = Object.keys(obj).find((k) => Array.isArray(obj[k]) && obj[k].length && typeof obj[k][0] === 'object');
        return arrKey ? obj[arrKey] : [obj];
      }
      return [{ value: obj }];
    } catch (e) {
      // newline-delimited JSON
      const out = [];
      const lines = s.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if (!ln) continue;
        try { out.push(JSON.parse(ln)); } catch (err) { throw new Error(`JSON parse error on line ${i + 1}: ${err.message}`); }
      }
      return out;
    }
  }
  function jsonToCsv(text) {
    const recs = parseJsonRecords(text);
    const cols = [];
    const seen = new Set();
    for (const r of recs) {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
      }
    }
    if (!cols.length) cols.push('value');
    const cell = (v) => {
      if (v == null) return '';
      if (typeof v === 'object') v = JSON.stringify(v);
      return csvCell(v);
    };
    const lines = [cols.map(csvCell).join(',')];
    for (const r of recs) {
      if (r && typeof r === 'object' && !Array.isArray(r)) lines.push(cols.map((c) => cell(r[c])).join(','));
      else lines.push(cell(r));
    }
    return { csv: lines.join('\n') + '\n', rows: recs.length, cols: cols.length };
  }

  async function createTableFromRegistered(tname, regName, kind) {
    let reader;
    if (kind === 'csv') reader = `read_csv_auto(${quoteStr(regName)}, header = true)`;
    else if (kind === 'parquet') reader = `read_parquet(${quoteStr(regName)})`;
    else reader = `read_json_auto(${quoteStr(regName)})`;
    await rawQuery(`CREATE OR REPLACE TABLE ${quoteIdent(tname)} AS SELECT * FROM ${reader}`, 'load');
    const cnt = await rawQuery(`SELECT count(*) AS n FROM ${quoteIdent(tname)}`, 'load');
    return Number(cnt.getChildAt(0).get(0));
  }

  async function loadText(fileName, text, kind) {
    const t0 = performance.now();
    const tname = tableNameFor(fileName);
    let n;
    if (kind === 'json') {
      const conv = jsonToCsv(text);
      dlog('load', `${fileName}: JSON parsed in JS (${conv.rows} records, ${conv.cols} columns) -> CSV`, { ms: Math.round(performance.now() - t0) });
      const reg = tname + '__json.csv';
      await state.db.registerFileText(reg, conv.csv);
      n = await createTableFromRegistered(tname, reg, 'csv');
    } else {
      await state.db.registerFileText(fileName, text);
      n = await createTableFromRegistered(tname, fileName, kind);
    }
    toast(t('loadedTable', { t: tname, n }));
    dlog('load', `${fileName} -> ${tname}`, { rows: n, ms: Math.round(performance.now() - t0) });
    return tname;
  }

  async function loadFile(file) {
    const name = file.name;
    const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    const t0 = performance.now();
    try {
      let kind;
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') kind = 'csv';
      else if (ext === 'parquet' || ext === 'pq') kind = 'parquet';
      else if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') kind = 'json';
      else if (ext === 'xlsx' || ext === 'xls') kind = 'xlsx';
      else { toast(t('unsupportedFile', { f: name }), true); dlog('error', 'unsupported file ' + name); return; }

      if (kind === 'xlsx') {
        const XLSX = await loadXlsxLib();
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
        for (let i = 0; i < wb.SheetNames.length; i++) {
          const sheet = wb.SheetNames[i];
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet], { rawNumbers: true });
          const tname = tableNameFor(name) + (wb.SheetNames.length > 1 ? '_' + tableNameFor(sheet) : '');
          const reg = tname + '__sheet.csv';
          await state.db.registerFileText(reg, csv);
          const n = await createTableFromRegistered(tname, reg, 'csv');
          toast(t('loadedTable', { t: tname, n }));
          dlog('load', `${name} [${sheet}] -> ${tname}`, { rows: n, ms: Math.round(performance.now() - t0) });
        }
      } else if (kind === 'json') {
        await loadText(name, await file.text(), 'json');
      } else {
        const tname = tableNameFor(name);
        try {
          await state.db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
        } catch (e) {
          dlog('warn', 'registerFileHandle failed, falling back to buffer: ' + e.message);
          await state.db.registerFileBuffer(name, new Uint8Array(await file.arrayBuffer()));
        }
        const n = await createTableFromRegistered(tname, name, kind);
        toast(t('loadedTable', { t: tname, n }));
        dlog('load', `${name} -> ${tname}`, { rows: n, ms: Math.round(performance.now() - t0) });
      }
    } catch (e) {
      let msg = e.message || String(e);
      if (ext === 'parquet' || ext === 'pq') msg += ' | ' + t('parquetNeedsNet');
      toast(t('loadFailed', { f: name }) + ' - ' + msg, true);
      dlog('error', 'load ' + name + ': ' + msg);
    }
  }

  async function loadFiles(files) {
    for (const f of Array.from(files)) await loadFile(f);
    await refreshSchema();
  }

  async function loadTextAsTable(fileName, text) {
    const tname = await loadText(fileName, text, /\.csv$/i.test(fileName) ? 'csv' : 'json');
    await refreshSchema();
    return tname;
  }

  // ---------------------------------------------------------------- schema panel
  async function refreshSchema() {
    const res = await rawQuery(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`, 'schema');
    const map = new Map();
    for (let i = 0; i < res.numRows; i++) {
      const tn = res.getChildAt(0).get(i);
      if (!map.has(tn)) map.set(tn, []);
      map.get(tn).push({ name: res.getChildAt(1).get(i), type: res.getChildAt(2).get(i) });
    }
    const tables = [];
    for (const [name, cols] of map) {
      let rows = null;
      try { rows = Number((await rawQuery(`SELECT count(*) FROM ${quoteIdent(name)}`, 'schema')).getChildAt(0).get(0)); } catch (e) { /* views etc. */ }
      tables.push({ name, cols, rows });
    }
    state.tables = tables;
    const box = $('#schemaList');
    box.innerHTML = '';
    if (!tables.length) { box.innerHTML = '<p class="muted">' + t('noTables') + '</p>'; }
    tables.forEach((tb) => {
      const det = document.createElement('details');
      det.className = 'schema-table';
      det.dataset.table = tb.name;
      const sum = document.createElement('summary');
      const nm = document.createElement('button');
      nm.type = 'button'; nm.className = 'link'; nm.textContent = tb.name;
      nm.title = 'SELECT * FROM ' + tb.name + ' LIMIT 100';
      nm.addEventListener('click', (ev) => { ev.preventDefault(); setSql(`SELECT * FROM ${quoteIdent(tb.name)} LIMIT 100;`); runUserQuery(getSql()); });
      sum.appendChild(nm);
      const meta = document.createElement('span');
      meta.className = 'muted small';
      meta.textContent = ' ' + (tb.rows != null ? tb.rows.toLocaleString() + ' ' + t('rowsSuffix') : '');
      sum.appendChild(meta);
      det.appendChild(sum);
      const ul = document.createElement('ul');
      tb.cols.forEach((c) => {
        const li = document.createElement('li');
        const cn = document.createElement('span'); cn.textContent = c.name;
        const ct = document.createElement('span'); ct.className = 'muted small'; ct.textContent = ' ' + c.type;
        li.appendChild(cn); li.appendChild(ct);
        li.addEventListener('click', () => insertAtCursor(quoteIdentIfNeeded(c.name)));
        ul.appendChild(li);
      });
      det.appendChild(ul);
      box.appendChild(det);
    });
    renderPresets();
    renderExamples();
  }
  function quoteIdentIfNeeded(n) { return /^[a-z_][a-z0-9_]*$/.test(n) ? n : quoteIdent(n); }

  // ---------------------------------------------------------------- presets & examples
  const TS = 'CAST("timestamp" AS TIMESTAMP)';
  const PRESETS = [
    { id: 'errors_per_hour', chart: { x: 'hour', y: 'errors', type: 'line' },
      sql: `-- Errors per hour\nSELECT date_trunc('hour', ${TS}) AS hour,\n       count(*) AS errors\nFROM app_log\nWHERE level = 'ERROR'\nGROUP BY 1\nORDER BY 1;` },
    { id: 'level_counts', chart: { x: 'level', y: 'n', type: 'bar' },
      sql: `-- Count by level\nSELECT level, count(*) AS n\nFROM app_log\nGROUP BY level\nORDER BY n DESC;` },
    { id: 'slowest_modules', chart: { x: 'module', y: 'p95_ms', type: 'bar' },
      sql: `-- Slowest modules by p95 latency\nSELECT module,\n       count(*) AS calls,\n       round(avg(elapsed_ms), 1) AS avg_ms,\n       quantile_cont(elapsed_ms, 0.95) AS p95_ms,\n       max(elapsed_ms) AS max_ms\nFROM app_log\nGROUP BY module\nORDER BY p95_ms DESC;` },
    { id: 'top_errors', chart: { x: 'message', y: 'n', type: 'bar' },
      sql: `-- Top error messages\nSELECT message,\n       count(*) AS n,\n       min(${TS}) AS first_seen,\n       max(${TS}) AS last_seen\nFROM app_log\nWHERE level = 'ERROR'\nGROUP BY message\nORDER BY n DESC, message\nLIMIT 20;` },
    { id: 'slow_requests', chart: { x: 'timestamp', y: 'elapsed_ms', type: 'bar' },
      sql: `-- Slow requests (> 1000 ms)\nSELECT "timestamp", module, level, message, elapsed_ms, request_id\nFROM app_log\nWHERE elapsed_ms > 1000\nORDER BY elapsed_ms DESC\nLIMIT 200;` },
    { id: 'module_hour_heat', chart: { x: 'module', y: 'errors', type: 'bar' },
      sql: `-- Errors by module and hour\nSELECT module,\n       date_trunc('hour', ${TS}) AS hour,\n       count(*) AS errors\nFROM app_log\nWHERE level = 'ERROR'\nGROUP BY ALL\nORDER BY errors DESC, module, hour\nLIMIT 100;` }
  ];
  function renderPresets() {
    const box = $('#presetList');
    box.innerHTML = '';
    const hasLog = state.tables.some((x) => x.name === 'app_log');
    $('#presetHint').hidden = hasLog;
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.preset = p.id;
      b.textContent = t('p_' + p.id);
      b.disabled = !hasLog;
      b.addEventListener('click', () => runPreset(p.id));
      box.appendChild(b);
    });
  }
  async function runPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return null;
    setSql(p.sql);
    state.chartHint = p.chart;
    return runUserQuery(p.sql);
  }
  function renderExamples() {
    const box = $('#exampleList');
    box.innerHTML = '';
    const first = state.tables[0] ? quoteIdent(state.tables[0].name) : null;
    const ex = [
      { k: 'ex_list_tables', sql: 'SHOW ALL TABLES;' },
      first && { k: 'ex_preview', sql: `SELECT * FROM ${first} LIMIT 100;` },
      first && { k: 'ex_describe', sql: `DESCRIBE ${first};` },
      first && { k: 'ex_summarize', sql: `SUMMARIZE ${first};` },
      state.tables.some((x) => x.name === 'sales') && { k: 'ex_sales', sql: `SELECT region, sum(qty * unit_price) AS revenue, count(*) AS orders\nFROM sales\nGROUP BY region\nORDER BY revenue DESC;` }
    ].filter(Boolean);
    ex.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip chip-alt'; b.textContent = t(e.k);
      b.addEventListener('click', () => { setSql(e.sql); runUserQuery(e.sql); });
      box.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- history
  function addHistory(sql, rows, ms) {
    state.history = state.history.filter((h) => h.sql !== sql);
    state.history.unshift({ sql, rows, ms, at: new Date().toISOString() });
    state.history = state.history.slice(0, 50);
    lsSet('ddb.history', state.history);
    renderHistory();
  }
  function renderHistory() {
    const ul = $('#historyList');
    ul.innerHTML = '';
    if (!state.history.length) { ul.innerHTML = '<li class="muted">' + t('historyEmpty') + '</li>'; return; }
    state.history.forEach((h) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'hist';
      b.title = h.sql;
      b.textContent = h.sql.replace(/^--.*\n/, '').replace(/\s+/g, ' ').slice(0, 80);
      const meta = document.createElement('span');
      meta.className = 'muted small';
      meta.textContent = `${h.at.slice(5, 16).replace('T', ' ')} · ${h.rows} · ${h.ms} ms`;
      b.appendChild(document.createElement('br'));
      b.appendChild(meta);
      b.addEventListener('click', () => setSql(h.sql));
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- editor
  function getSql() {
    const ta = $('#sql');
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    return sel.trim() ? sel : ta.value;
  }
  function setSql(s) { const ta = $('#sql'); ta.value = s; lsSet('ddb.sql', s); }
  function insertAtCursor(text) {
    const ta = $('#sql');
    const a = ta.selectionStart; const b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
    ta.focus();
  }

  // ---------------------------------------------------------------- language / theme
  function applyLang(lang) {
    I18N.setLang(lang);
    lsSet('ddb.lang', lang);
    I18N.apply(document);
    applyThemeLabel();
    renderPresets(); renderExamples(); renderHistory();
    if (state.result) renderResult(); else if (!$('#queryError')) renderResult();
    if (state.conn) refreshSchema().catch((e) => dlog('error', 'schema refresh: ' + e.message));
    else if (!state.tables.length) $('#schemaList').innerHTML = '<p class="muted">' + t('noTables') + '</p>';
    const s = $('#status');
    if (s.dataset.state === 'ready') s.textContent = t('statusReady');
    dlog('ui', 'language -> ' + lang);
  }
  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', state.theme);
    applyThemeLabel();
  }
  function applyThemeLabel() {
    $('#themeBtn').textContent = t(state.theme === 'light' ? 'themeLight' : state.theme === 'dark' ? 'themeDark' : 'themeAuto');
  }

  function setDebugOpen(open) {
    $('#debugPanel').hidden = !open;
    $('#debugBtn').setAttribute('aria-pressed', String(open));
    document.body.classList.toggle('debug-open', open); // reserve space so the panel never covers content
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    $('#runBtn').addEventListener('click', () => runUserQuery(getSql()));
    $('#sql').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runUserQuery(getSql()); }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); insertAtCursor('  '); }
    });
    $('#sql').addEventListener('input', () => lsSet('ddb.sql', $('#sql').value));
    $('#fileInput').addEventListener('change', async (e) => { const files = e.target.files; await loadFiles(files); e.target.value = ''; });
    const dz = $('#dropZone');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });
    // page-wide drop target too
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { if (!dz.contains(e.target)) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); } });
    $('#sampleLogBtn').addEventListener('click', async () => {
      await loadTextAsTable('app-log.jsonl', SampleGen.generateLogJsonl());
      await runPreset('errors_per_hour');
    });
    $('#sampleSalesBtn').addEventListener('click', async () => { await loadTextAsTable('sales.csv', SampleGen.generateSalesCsv()); });
    $('#prevBtn').addEventListener('click', () => { if (state.page > 0) { state.page--; renderResult(); } });
    $('#nextBtn').addEventListener('click', () => { state.page++; renderResult(); });
    $('#pageSize').value = String(state.pageSize);
    $('#pageSize').addEventListener('change', (e) => { state.pageSize = parseInt(e.target.value, 10) || 50; lsSet('ddb.pageSize', state.pageSize); state.page = 0; renderResult(); });
    $('#exportBtn').addEventListener('click', exportCsv);
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    ['#chartType', '#chartX', '#chartY'].forEach((s) => $(s).addEventListener('change', drawChart));
    $('#langBtn').addEventListener('click', () => applyLang(I18N.getLang() === 'zh-TW' ? 'en' : 'zh-TW'));
    $('#themeBtn').addEventListener('click', () => {
      state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
      lsSet('ddb.theme', state.theme);
      applyTheme();
    });
    $('#debugBtn').addEventListener('click', () => setDebugOpen($('#debugPanel').hidden));
    $('#debugClose').addEventListener('click', () => setDebugOpen(false));
    $('#debugClear').addEventListener('click', () => { debugEntries.length = 0; $('#debugList').innerHTML = ''; });
    $('#clearHistory').addEventListener('click', () => { state.history = []; lsSet('ddb.history', []); renderHistory(); });
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.view === 'chart') drawChart(); }, 200); });
  }

  async function main() {
    const lang = params.get('lang') || lsGet('ddb.lang', 'zh-TW');
    I18N.setLang(I18N.languages.includes(lang) ? lang : 'zh-TW');
    I18N.apply(document);
    applyTheme();
    wire();
    if (DEBUG) setDebugOpen(true);
    dlog('init', `mode=${CFG.mode} debug=${DEBUG} ua=${navigator.userAgent}`);
    $('#sql').value = lsGet('ddb.sql', "SELECT 42 AS answer, 'DuckDB-WASM' AS engine;");
    renderHistory();
    renderResult();
    try {
      await initDuckDB();
      await refreshSchema();
      document.body.dataset.ready = '1';
    } catch (e) {
      setStatus('error', t('statusInitFailed'));
      showError(t('statusInitFailed') + ': ' + (e.message || e));
      dlog('error', 'init failed: ' + (e.stack || e.message || e));
      document.body.dataset.ready = 'error';
    }
  }

  // Small API for automation / DevTools
  window.DDB = { runQuery: (sql) => runUserQuery(sql), runPreset, loadFiles, state, presets: PRESETS.map((p) => p.id), buildCsv: () => buildCsv() };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
