/* UI strings: zh-TW (default) and en. Attaches `I18N` to globalThis. */
(function (root) {
  'use strict';
  const STRINGS = {
    'zh-TW': {
      appTitle: 'DuckDB-WASM 資料分析台',
      appSubtitle: '純瀏覽器、零後端：拖放檔案，用 SQL 分析',
      statusLoading: '正在載入 DuckDB-WASM…',
      statusReady: '就緒',
      statusRunning: '執行中…',
      statusError: '錯誤',
      statusInitFailed: 'DuckDB 初始化失敗',
      langBtn: 'English',
      themeAuto: '主題：自動',
      themeLight: '主題：淺色',
      themeDark: '主題：深色',
      debugBtn: '除錯記錄',
      dataSources: '資料來源',
      dropHint: '拖放 CSV / Parquet / JSON / JSONL / XLSX 檔案到這裡，或',
      chooseFiles: '選擇檔案',
      loadSampleLog: '載入範例 App Log',
      loadSampleSales: '載入範例銷售 CSV',
      schema: '資料表與欄位',
      noTables: '尚未載入任何資料表',
      rowsSuffix: '列',
      presets: 'Log 分析預設查詢',
      presetsNeedLog: '需要資料表 app_log（請先載入範例 App Log 或你的 JSONL 檔）',
      examples: '通用範例查詢',
      history: '查詢歷史',
      historyEmpty: '尚無歷史',
      clearHistory: '清除',
      sqlEditor: 'SQL 編輯器',
      runBtn: '執行 (Ctrl+Enter)',
      exportCsv: '匯出 CSV',
      excelBom: 'Excel 相容 (BOM)',
      tabTable: '表格',
      tabChart: '圖表',
      rows: '列數',
      queryTime: '耗時',
      page: '頁',
      prev: '上一頁',
      next: '下一頁',
      pageSize: '每頁',
      noResult: '尚無結果，請執行查詢。',
      noRows: '查詢成功，但沒有資料列。',
      chartType: '圖表類型',
      bar: '長條圖',
      line: '折線圖',
      xCol: 'X 軸欄位',
      yCol: 'Y 軸欄位（數值）',
      drawChart: '繪製',
      chartNoNumeric: '結果中沒有數值欄位可作圖。',
      chartTruncated: '僅顯示前 {n} 列',
      loadedTable: '已載入資料表 {t}（{n} 列）',
      loadFailed: '載入失敗：{f}',
      unsupportedFile: '不支援的檔案類型：{f}',
      exported: '已匯出 {n} 列',
      debugTitle: '除錯記錄（每個查詢、耗時與錯誤）',
      debugClear: '清除',
      debugClose: '關閉',
      p_errors_per_hour: '每小時錯誤數',
      p_level_counts: '各等級筆數',
      p_slowest_modules: '最慢模組 (p95)',
      p_top_errors: '最常見錯誤訊息',
      p_slow_requests: '慢請求 (> 1000 ms)',
      p_module_hour_heat: '模組 × 小時 錯誤數',
      ex_list_tables: '列出所有資料表',
      ex_preview: '預覽第一個資料表',
      ex_describe: '描述第一個資料表',
      ex_summarize: 'SUMMARIZE 第一個資料表',
      ex_sales: '銷售：各區域營收',
      footer: '所有資料只在你的瀏覽器中處理，不會上傳到任何伺服器。',
      persistNote: '提示：重新整理頁面後資料表會消失（未啟用持久化）。',
      parquetNeedsNet: 'Parquet 需要 DuckDB 從 extensions.duckdb.org 下載 parquet 擴充套件（需網路連線）'
    },
    en: {
      appTitle: 'DuckDB-WASM Data Desk',
      appSubtitle: 'In-browser, zero backend: drop files, analyse with SQL',
      statusLoading: 'Loading DuckDB-WASM…',
      statusReady: 'Ready',
      statusRunning: 'Running…',
      statusError: 'Error',
      statusInitFailed: 'DuckDB failed to initialise',
      langBtn: '中文',
      themeAuto: 'Theme: auto',
      themeLight: 'Theme: light',
      themeDark: 'Theme: dark',
      debugBtn: 'Debug log',
      dataSources: 'Data sources',
      dropHint: 'Drop CSV / Parquet / JSON / JSONL / XLSX files here, or',
      chooseFiles: 'choose files',
      loadSampleLog: 'Load sample app log',
      loadSampleSales: 'Load sample sales CSV',
      schema: 'Tables & columns',
      noTables: 'No tables loaded yet',
      rowsSuffix: 'rows',
      presets: 'Log analysis presets',
      presetsNeedLog: 'Needs table app_log (load the sample app log or your own JSONL first)',
      examples: 'Example queries',
      history: 'Query history',
      historyEmpty: 'No history yet',
      clearHistory: 'Clear',
      sqlEditor: 'SQL editor',
      runBtn: 'Run (Ctrl+Enter)',
      exportCsv: 'Export CSV',
      excelBom: 'Excel-friendly (BOM)',
      tabTable: 'Table',
      tabChart: 'Chart',
      rows: 'Rows',
      queryTime: 'Time',
      page: 'Page',
      prev: 'Prev',
      next: 'Next',
      pageSize: 'Page size',
      noResult: 'No result yet. Run a query.',
      noRows: 'Query succeeded but returned no rows.',
      chartType: 'Chart type',
      bar: 'Bar',
      line: 'Line',
      xCol: 'X column',
      yCol: 'Y column (numeric)',
      drawChart: 'Draw',
      chartNoNumeric: 'No numeric column in the result to chart.',
      chartTruncated: 'Showing first {n} rows only',
      loadedTable: 'Loaded table {t} ({n} rows)',
      loadFailed: 'Failed to load: {f}',
      unsupportedFile: 'Unsupported file type: {f}',
      exported: 'Exported {n} rows',
      debugTitle: 'Debug log (every query, timing and error)',
      debugClear: 'Clear',
      debugClose: 'Close',
      p_errors_per_hour: 'Errors per hour',
      p_level_counts: 'Count by level',
      p_slowest_modules: 'Slowest modules (p95)',
      p_top_errors: 'Top error messages',
      p_slow_requests: 'Slow requests (> 1000 ms)',
      p_module_hour_heat: 'Errors by module x hour',
      ex_list_tables: 'List all tables',
      ex_preview: 'Preview first table',
      ex_describe: 'Describe first table',
      ex_summarize: 'SUMMARIZE first table',
      ex_sales: 'Sales: revenue by region',
      footer: 'All data is processed locally in your browser and never uploaded.',
      persistNote: 'Note: tables are lost on page reload (no persistence).',
      parquetNeedsNet: 'Parquet needs DuckDB to download the parquet extension from extensions.duckdb.org (network required)'
    }
  };

  let current = 'zh-TW';

  function t(key, vars) {
    const table = STRINGS[current] || STRINGS['zh-TW'];
    let s = table[key] != null ? table[key] : (STRINGS.en[key] != null ? STRINGS.en[key] : key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  }

  function apply(doc) {
    doc = doc || document;
    doc.documentElement.lang = current;
    doc.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    doc.title = t('appTitle');
  }

  function setLang(lang) { if (STRINGS[lang]) current = lang; }
  function getLang() { return current; }

  root.I18N = { t, apply, setLang, getLang, languages: Object.keys(STRINGS) };
})(typeof globalThis !== 'undefined' ? globalThis : window);
