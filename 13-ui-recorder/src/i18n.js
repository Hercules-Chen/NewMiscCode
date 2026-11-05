// zh-TW / en strings for the CLI and the in-page toolbar.
export const LANGS = ['zh-TW', 'en'];

export function normalizeLang(l) {
  const s = String(l || '').toLowerCase();
  if (s.startsWith('en')) return 'en';
  return 'zh-TW';
}

export const MESSAGES = {
  'zh-TW': {
    'cli.usage': [
      'UI 錄製器 ui-recorder：把瀏覽器操作錄成 01-mcp-ui-verifier 情境 JSON',
      '',
      '用法：',
      '  node src/cli.js record <url> [--out my.json] [--name 名稱] [--lang zh-TW|en] [--debug]',
      '  node src/cli.js record <url> --script steps.js [--out my.json] [--headed]   以程式驅動（預設無頭）',
      '',
      '在瀏覽器右下角的工具列操作：開始/暫停、加入斷言、截圖標註、停止並儲存。關閉瀏覽器視窗也會儲存。',
      '結束代碼：0 = 已儲存，2 = 參數或執行錯誤',
    ].join('\n'),
    'cli.launch': '啟動 Chromium（{mode}）並開啟 {url}',
    'cli.headed': '有視窗',
    'cli.headless': '無頭',
    'cli.waiting': '錄製中… 請在瀏覽器操作，完成後按工具列的「停止並儲存」或關閉視窗。',
    'cli.script': '執行腳本：{file}',
    'cli.saved': '已儲存情境（{count} 個步驟）：{file}',
    'cli.validated': '已通過格式檢查（與 01-mcp-ui-verifier validateScenario 相同規則）',
    'cli.replay': '重播：node ../01-mcp-ui-verifier/src/cli.js run "{file}" --base-url {base}',
    'cli.log': '日誌：{file}',
    'cli.error': '錯誤：{message}',
    'cli.noUrl': '請提供要錄製的網址，例如：node src/cli.js record http://127.0.0.1:4173/',
    'tb.title': 'UI 錄製器',
    'tb.pause': '暫停',
    'tb.resume': '開始',
    'tb.assert': '加入斷言',
    'tb.assertOn': '點選要斷言的元素…',
    'tb.annotate': '截圖標註',
    'tb.annotateOn': '完成標註 ({n})',
    'tb.stop': '停止並儲存',
    'tb.steps': '{n} 步',
    'tb.paused': '已暫停',
    'tb.recording': '錄製中',
    'tb.saved': '已儲存，可關閉視窗',
    'tb.lang': 'EN',
    'tb.annotLabel': '標註截圖',
  },
  en: {
    'cli.usage': [
      'ui-recorder: record browser interactions into a 01-mcp-ui-verifier scenario JSON',
      '',
      'Usage:',
      '  node src/cli.js record <url> [--out my.json] [--name NAME] [--lang zh-TW|en] [--debug]',
      '  node src/cli.js record <url> --script steps.js [--out my.json] [--headed]   drive by script (headless by default)',
      '',
      'Use the toolbar in the bottom-right corner of the page: Start/Pause, Add assertion, Annotate, Stop & save. Closing the window also saves.',
      'Exit codes: 0 = saved, 2 = usage or runtime error',
    ].join('\n'),
    'cli.launch': 'Launching Chromium ({mode}) at {url}',
    'cli.headed': 'headed',
    'cli.headless': 'headless',
    'cli.waiting': 'Recording... interact with the browser, then press "Stop & save" in the toolbar or close the window.',
    'cli.script': 'Running script: {file}',
    'cli.saved': 'Scenario saved ({count} steps): {file}',
    'cli.validated': 'Format check passed (same rules as 01-mcp-ui-verifier validateScenario)',
    'cli.replay': 'Replay: node ../01-mcp-ui-verifier/src/cli.js run "{file}" --base-url {base}',
    'cli.log': 'Log: {file}',
    'cli.error': 'Error: {message}',
    'cli.noUrl': 'Please give a URL to record, e.g. node src/cli.js record http://127.0.0.1:4173/',
    'tb.title': 'UI Recorder',
    'tb.pause': 'Pause',
    'tb.resume': 'Start',
    'tb.assert': 'Add assertion',
    'tb.assertOn': 'Pick an element...',
    'tb.annotate': 'Annotate',
    'tb.annotateOn': 'Finish annotate ({n})',
    'tb.stop': 'Stop & save',
    'tb.steps': '{n} steps',
    'tb.paused': 'Paused',
    'tb.recording': 'Recording',
    'tb.saved': 'Saved, you can close the window',
    'tb.lang': '中',
    'tb.annotLabel': 'Annotated screenshot',
  },
};

export function t(lang, key, vars = {}) {
  const L = MESSAGES[normalizeLang(lang)];
  const s = L[key] ?? MESSAGES.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Toolbar strings for both languages (sent into the page). */
export function toolbarStrings() {
  const out = {};
  for (const l of LANGS) out[l] = Object.fromEntries(Object.entries(MESSAGES[l]).filter(([k]) => k.startsWith('tb.')).map(([k, v]) => [k.slice(3), v]));
  return out;
}
