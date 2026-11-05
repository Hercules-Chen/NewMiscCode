// Simple i18n table (zh-TW primary, en secondary).
// t(lang, key, vars) -> string; missing keys fall back to zh-TW, then the key itself.

export const SUPPORTED_LANGS = ['zh-TW', 'en'];

const TABLE = {
  'zh-TW': {
    'report.title': 'UI 驗證報告',
    'report.generatedAt': '產生時間',
    'report.tab.summary': '摘要',
    'report.tab.steps': '步驟',
    'report.tab.screenshots': '截圖',
    'report.tab.console': '主控台訊息',
    'report.tab.env': '環境與計時',
    'report.result': '結果',
    'report.pass': '通過',
    'report.fail': '失敗',
    'report.skip': '略過',
    'report.overallPass': '全部通過',
    'report.overallFail': '有失敗項目',
    'report.totalSteps': '總步驟數',
    'report.passed': '通過',
    'report.failed': '失敗',
    'report.skipped': '略過',
    'report.duration': '總耗時',
    'report.consoleErrors': '主控台錯誤數',
    'report.col.no': '#',
    'report.col.status': '狀態',
    'report.col.action': '動作',
    'report.col.target': '目標',
    'report.col.detail': '說明',
    'report.col.time': '耗時 (ms)',
    'report.col.shot': '截圖',
    'report.col.type': '類型',
    'report.col.text': '內容',
    'report.col.location': '位置',
    'report.col.at': '時間',
    'report.noShots': '沒有截圖。',
    'report.noConsole': '沒有收集到主控台錯誤或警告。',
    'report.failures': '失敗項目',
    'report.noFailures': '沒有失敗項目。',
    'report.viewShot': '查看截圖',
    'report.clickToZoom': '點擊圖片可放大 / 縮小',
    'report.env.scenario': '情境',
    'report.env.browser': '瀏覽器',
    'report.env.viewport': '視窗大小',
    'report.env.start': '開始時間',
    'report.env.end': '結束時間',
    'report.env.outDir': '輸出資料夾',
    'report.env.log': '日誌檔 (JSONL)',
    'report.env.trace': 'Playwright 追蹤檔',
    'report.env.options': '執行選項',
    'report.env.pageTimings': '頁面載入計時',
    'report.env.none': '（無）',
    'report.timing.url': '網址',
    'report.timing.dcl': 'DOMContentLoaded (ms)',
    'report.timing.load': 'load (ms)',
    'report.timing.ttfb': 'TTFB (ms)',
    'annot.notFound': '找不到元素',
    'annot.consoleErrors': '主控台錯誤',
    'annot.lastAction': '最後互動的元素',
    'step.open': '開啟頁面',
    'step.click': '點擊',
    'step.fill': '輸入文字',
    'step.press': '按鍵',
    'step.assert_visible': '確認可見',
    'step.assert_hidden': '確認不可見',
    'step.assert_text': '確認文字',
    'step.check_console_errors': '檢查主控台錯誤',
    'step.screenshot_annotate': '標註截圖',
    'step.wait': '等待',
    'step.wait_for': '等待元素',
    'msg.opened': '已開啟 {url}（HTTP {status}），標題：「{title}」',
    'msg.clicked': '已點擊 {selector}',
    'msg.filled': '已在 {selector} 輸入 {length} 個字元',
    'msg.pressed': '已在 {selector} 按下 {key}',
    'msg.visible': '{selector} 可見',
    'msg.hidden': '{selector} 不可見',
    'msg.notVisible': '{selector} 在 {timeout} ms 內未出現或不可見',
    'msg.stillVisible': '{selector} 在 {timeout} ms 後仍然可見',
    'msg.textOk': '{selector} 的文字符合：「{actual}」',
    'msg.textMismatch': '{selector} 的文字不符。預期{mode}「{expected}」，實際為「{actual}」',
    'msg.textNotFound': '找不到 {selector}，無法比對文字（預期「{expected}」）',
    'msg.mode.contains': '包含',
    'msg.mode.equals': '等於',
    'msg.mode.regex': '符合正規表示式',
    'msg.consoleNone': '沒有主控台錯誤',
    'msg.consoleFound': '發現 {count} 則主控台錯誤：{first}',
    'msg.consoleFoundAllowed': '發現 {count} 則主控台錯誤（未要求為零，僅記錄）',
    'msg.annotated': '已截圖並標註 {found} 個元素{missing}',
    'msg.annotMissing': '，{count} 個找不到：{list}',
    'msg.waited': '已等待 {ms} ms',
    'msg.noPage': '尚未開啟頁面，請先呼叫 open_page',
    'msg.unknownAction': '未知的動作：{action}',
    'msg.reportWritten': '報告已產生：{path}',
    'msg.skippedAfterFail': '因前面步驟失敗而略過',
    'cli.usage': `用法：
  node src/cli.js run <scenario.json> [選項]   執行情境並產生報告
  node src/cli.js demo [選項]                  啟動內建示範網站並執行示範情境
  node src/cli.js serve-demo [--port 4173]     只啟動示範網站（Ctrl+C 結束）

選項：
  --lang zh-TW|en        報告與訊息語言（預設 zh-TW）
  --out <dir>            輸出資料夾（預設：Windows 為 %ProgramData%\\NewMiscCode\\01-mcp-ui-verifier，其他為 ./output）
  --base-url <url>       覆寫情境的 baseUrl
  --headed               顯示瀏覽器視窗
  --devtools             顯示瀏覽器並自動開啟 Chrome DevTools
  --debug                除錯模式：headed + slowMo 250ms + 日誌等級 debug + trace
  --cdp-port <port>      開啟 Chrome 遠端除錯埠（可用 chrome://inspect 連線）
  --slowmo <ms>          每個動作延遲毫秒數
  --trace                產生 Playwright trace.zip（用 npx playwright show-trace 開啟）
  --timeout <ms>         每個步驟逾時（預設 5000）
  --log-level <lvl>      debug|info|warn|error（預設 info）
  --browser-path <path>  指定 Chromium 執行檔路徑
  -h, --help             顯示說明`,
    'cli.runStart': '開始執行情境：{name}',
    'cli.stepLine': '[{status}] #{no} {action} {target} ({ms} ms) {detail}',
    'cli.summary': '完成：{passed} 通過 / {failed} 失敗 / {skipped} 略過，共 {total} 步，耗時 {ms} ms',
    'cli.report': '報告：{path}',
    'cli.log': '日誌：{path}',
    'cli.trace': '追蹤檔：{path}',
    'cli.demoServer': '示範網站已啟動：{url}',
    'cli.demoNote': '示範情境刻意包含錯誤（主控台錯誤、缺少元素、文字不符），因此出現失敗是預期的結果。',
    'cli.serveHint': '按 Ctrl+C 結束。',
    'cli.error': '錯誤：{message}',
    'tool.result.pass': '通過',
    'tool.result.fail': '失敗',
  },
  en: {
    'report.title': 'UI Verification Report',
    'report.generatedAt': 'Generated at',
    'report.tab.summary': 'Summary',
    'report.tab.steps': 'Steps',
    'report.tab.screenshots': 'Screenshots',
    'report.tab.console': 'Console',
    'report.tab.env': 'Environment & timings',
    'report.result': 'Result',
    'report.pass': 'PASS',
    'report.fail': 'FAIL',
    'report.skip': 'SKIP',
    'report.overallPass': 'All passed',
    'report.overallFail': 'Failures found',
    'report.totalSteps': 'Total steps',
    'report.passed': 'Passed',
    'report.failed': 'Failed',
    'report.skipped': 'Skipped',
    'report.duration': 'Total duration',
    'report.consoleErrors': 'Console errors',
    'report.col.no': '#',
    'report.col.status': 'Status',
    'report.col.action': 'Action',
    'report.col.target': 'Target',
    'report.col.detail': 'Detail',
    'report.col.time': 'Time (ms)',
    'report.col.shot': 'Screenshot',
    'report.col.type': 'Type',
    'report.col.text': 'Text',
    'report.col.location': 'Location',
    'report.col.at': 'At',
    'report.noShots': 'No screenshots.',
    'report.noConsole': 'No console errors or warnings were collected.',
    'report.failures': 'Failures',
    'report.noFailures': 'No failures.',
    'report.viewShot': 'View screenshot',
    'report.clickToZoom': 'Click an image to zoom in / out',
    'report.env.scenario': 'Scenario',
    'report.env.browser': 'Browser',
    'report.env.viewport': 'Viewport',
    'report.env.start': 'Started',
    'report.env.end': 'Finished',
    'report.env.outDir': 'Output directory',
    'report.env.log': 'Log file (JSONL)',
    'report.env.trace': 'Playwright trace',
    'report.env.options': 'Run options',
    'report.env.pageTimings': 'Page load timings',
    'report.env.none': '(none)',
    'report.timing.url': 'URL',
    'report.timing.dcl': 'DOMContentLoaded (ms)',
    'report.timing.load': 'load (ms)',
    'report.timing.ttfb': 'TTFB (ms)',
    'annot.notFound': 'Element not found',
    'annot.consoleErrors': 'Console errors',
    'annot.lastAction': 'Last interacted element',
    'step.open': 'Open page',
    'step.click': 'Click',
    'step.fill': 'Fill',
    'step.press': 'Press key',
    'step.assert_visible': 'Assert visible',
    'step.assert_hidden': 'Assert hidden',
    'step.assert_text': 'Assert text',
    'step.check_console_errors': 'Check console errors',
    'step.screenshot_annotate': 'Annotated screenshot',
    'step.wait': 'Wait',
    'step.wait_for': 'Wait for element',
    'msg.opened': 'Opened {url} (HTTP {status}), title: "{title}"',
    'msg.clicked': 'Clicked {selector}',
    'msg.filled': 'Filled {length} characters into {selector}',
    'msg.pressed': 'Pressed {key} on {selector}',
    'msg.visible': '{selector} is visible',
    'msg.hidden': '{selector} is hidden',
    'msg.notVisible': '{selector} did not become visible within {timeout} ms',
    'msg.stillVisible': '{selector} is still visible after {timeout} ms',
    'msg.textOk': 'Text of {selector} matches: "{actual}"',
    'msg.textMismatch': 'Text of {selector} does not match. Expected to {mode} "{expected}", got "{actual}"',
    'msg.textNotFound': '{selector} not found; cannot compare text (expected "{expected}")',
    'msg.mode.contains': 'contain',
    'msg.mode.equals': 'equal',
    'msg.mode.regex': 'match regex',
    'msg.consoleNone': 'No console errors',
    'msg.consoleFound': 'Found {count} console error(s): {first}',
    'msg.consoleFoundAllowed': 'Found {count} console error(s) (zero not required, recorded only)',
    'msg.annotated': 'Screenshot taken, {found} element(s) annotated{missing}',
    'msg.annotMissing': ', {count} not found: {list}',
    'msg.waited': 'Waited {ms} ms',
    'msg.noPage': 'No page is open yet; call open_page first',
    'msg.unknownAction': 'Unknown action: {action}',
    'msg.reportWritten': 'Report written: {path}',
    'msg.skippedAfterFail': 'Skipped because an earlier step failed',
    'cli.usage': `Usage:
  node src/cli.js run <scenario.json> [options]   Run a scenario and write a report
  node src/cli.js demo [options]                  Start the bundled demo site and run the demo scenario
  node src/cli.js serve-demo [--port 4173]        Only serve the demo site (Ctrl+C to stop)

Options:
  --lang zh-TW|en        Report / message language (default zh-TW)
  --out <dir>            Output dir (default: %ProgramData%\\NewMiscCode\\01-mcp-ui-verifier on Windows, ./output elsewhere)
  --base-url <url>       Override the scenario baseUrl
  --headed               Show the browser window
  --devtools             Show the browser and auto-open Chrome DevTools
  --debug                Debug mode: headed + slowMo 250ms + log level debug + trace
  --cdp-port <port>      Open the Chrome remote debugging port (attach via chrome://inspect)
  --slowmo <ms>          Delay every action by N ms
  --trace                Record Playwright trace.zip (open with npx playwright show-trace)
  --timeout <ms>         Per-step timeout (default 5000)
  --log-level <lvl>      debug|info|warn|error (default info)
  --browser-path <path>  Chromium executable path
  -h, --help             Show help`,
    'cli.runStart': 'Running scenario: {name}',
    'cli.stepLine': '[{status}] #{no} {action} {target} ({ms} ms) {detail}',
    'cli.summary': 'Done: {passed} passed / {failed} failed / {skipped} skipped, {total} steps, {ms} ms',
    'cli.report': 'Report: {path}',
    'cli.log': 'Log: {path}',
    'cli.trace': 'Trace: {path}',
    'cli.demoServer': 'Demo site running at {url}',
    'cli.demoNote': 'The demo scenario contains deliberate bugs (console error, missing element, wrong text), so failures are expected.',
    'cli.serveHint': 'Press Ctrl+C to stop.',
    'cli.error': 'Error: {message}',
    'tool.result.pass': 'PASS',
    'tool.result.fail': 'FAIL',
  },
};

export function normalizeLang(lang) {
  if (!lang) return 'zh-TW';
  const l = String(lang).toLowerCase();
  if (l.startsWith('en')) return 'en';
  return 'zh-TW';
}

export function t(lang, key, vars = {}) {
  const L = normalizeLang(lang);
  let s = TABLE[L][key] ?? TABLE['zh-TW'][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
