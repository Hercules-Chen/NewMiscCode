// i18n.js - zh-TW (default) / en strings for the browser UI and the HTML report.
// No imports: also inlined into the self-contained report.

export const MESSAGES = {
  'zh-TW': {
    'app.title': '視覺回歸比對（Rust + WebAssembly）',
    'app.subtitle': '拖放兩張 PNG：基準圖（baseline）與目前畫面（current），在瀏覽器內以 WebAssembly 計算差異。',
    'lang.toggle': 'English',
    'drop.baseline': '基準圖 baseline.png',
    'drop.current': '目前畫面 current.png',
    'drop.hint': '拖放 PNG 到此處，或點擊選擇檔案',
    'drop.loaded': '已載入：',
    'opt.threshold': '門檻值 threshold',
    'opt.includeAA': '將反鋸齒像素算作差異',
    'opt.gap': '合併距離 gap（px）',
    'opt.ignore': '忽略區域（x,y,w,h；多個以分號分隔）',
    'btn.compare': '比對',
    'btn.download': '下載差異圖',
    'btn.sample': '載入範例圖',
    'stats.title': '比對結果',
    'stats.diffPixels': '差異像素',
    'stats.percent': '變更比例',
    'stats.boxes': '變更區塊',
    'stats.aaPixels': '反鋸齒像素（未計入）',
    'stats.size': '尺寸',
    'stats.time': 'WASM 耗時',
    'stats.none': '尚未比對。請先載入兩張 PNG。',
    'stats.same': '兩張圖相同（在門檻值內）。',
    'stats.changed': '偵測到變更。',
    'stats.mismatch': '注意：兩張圖尺寸不同，已以透明（視為白色）補齊後比對。',
    'err.png': '請選擇 PNG 檔案。',
    'err.wasm': '無法載入 WebAssembly 核心：',
    'mode.slider': '滑桿',
    'mode.side': '並排',
    'mode.onion': '洋蔥皮',
    'mode.diff': '差異圖',
    'img.baseline': '基準',
    'img.current': '目前',
    'img.diff': '差異',
    'box.list': '變更區塊清單',
    'report.title': '視覺回歸報告',
    'report.generated': '產生時間',
    'report.summary': '摘要',
    'report.pages': '頁面數',
    'report.passed': '通過',
    'report.changed': '有變更',
    'report.new': '新增（無基準）',
    'report.error': '錯誤',
    'report.status.pass': '通過',
    'report.status.changed': '有變更',
    'report.status.new': '新增',
    'report.status.error': '錯誤',
    'report.url': '網址',
    'report.approveHint': '確認變更為預期後，執行 vr approve 將目前畫面升級為基準。',
    'report.noBaseline': '尚無基準圖；執行 vr approve 以建立。',
    'debug.title': '除錯紀錄',
  },
  en: {
    'app.title': 'Visual Regression Diff (Rust + WebAssembly)',
    'app.subtitle': 'Drop two PNGs - baseline and current - and the diff is computed in your browser by WebAssembly.',
    'lang.toggle': '中文',
    'drop.baseline': 'Baseline baseline.png',
    'drop.current': 'Current current.png',
    'drop.hint': 'Drop a PNG here or click to choose a file',
    'drop.loaded': 'Loaded: ',
    'opt.threshold': 'Threshold',
    'opt.includeAA': 'Count anti-aliased pixels as differences',
    'opt.gap': 'Merge gap (px)',
    'opt.ignore': 'Ignore regions (x,y,w,h; separate with semicolons)',
    'btn.compare': 'Compare',
    'btn.download': 'Download diff',
    'btn.sample': 'Load sample images',
    'stats.title': 'Result',
    'stats.diffPixels': 'Diff pixels',
    'stats.percent': 'Changed',
    'stats.boxes': 'Changed regions',
    'stats.aaPixels': 'Anti-aliased pixels (not counted)',
    'stats.size': 'Size',
    'stats.time': 'WASM time',
    'stats.none': 'Nothing compared yet. Load two PNGs first.',
    'stats.same': 'Images are identical (within threshold).',
    'stats.changed': 'Changes detected.',
    'stats.mismatch': 'Note: image sizes differ; the smaller one was padded with transparent (white) pixels.',
    'err.png': 'Please choose a PNG file.',
    'err.wasm': 'Cannot load the WebAssembly core: ',
    'mode.slider': 'Slider',
    'mode.side': 'Side by side',
    'mode.onion': 'Onion skin',
    'mode.diff': 'Diff',
    'img.baseline': 'Baseline',
    'img.current': 'Current',
    'img.diff': 'Diff',
    'box.list': 'Changed regions',
    'report.title': 'Visual Regression Report',
    'report.generated': 'Generated',
    'report.summary': 'Summary',
    'report.pages': 'Pages',
    'report.passed': 'Passed',
    'report.changed': 'Changed',
    'report.new': 'New (no baseline)',
    'report.error': 'Errors',
    'report.status.pass': 'pass',
    'report.status.changed': 'changed',
    'report.status.new': 'new',
    'report.status.error': 'error',
    'report.url': 'URL',
    'report.approveHint': 'If the changes are intended, run vr approve to promote current screenshots to baseline.',
    'report.noBaseline': 'No baseline yet; run vr approve to create it.',
    'debug.title': 'Debug log',
  },
};

export const LANGS = ['zh-TW', 'en'];

export function makeT(lang) {
  const dict = MESSAGES[lang] || MESSAGES['zh-TW'];
  return (k) => (k in dict ? dict[k] : (MESSAGES['zh-TW'][k] ?? k));
}

/** Fill every [data-i18n] element (textContent) and [data-i18n-ph] (placeholder) under root. */
export function applyI18n(root, lang) {
  const t = makeT(lang);
  root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(n => { n.setAttribute('placeholder', t(n.dataset.i18nPh)); });
  if (root.documentElement) root.documentElement.lang = lang;
  return t;
}

/** Language from ?lang=, then localStorage, then zh-TW. */
export function initialLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) return q;
    const s = localStorage.getItem('vr.lang');
    if (LANGS.includes(s)) return s;
  } catch { /* storage may be blocked */ }
  return 'zh-TW';
}
