// zh-TW / en message catalog. Every finding carries both languages so reports can toggle.
export const LANGS = ['zh-TW', 'en'];

export const RULES_META = {
  R1: { 'zh-TW': '禁止同步等待非同步（sync-over-async）', en: 'No sync-over-async blocking' },
  R2: { 'zh-TW': '優先使用非同步（async void／同步 I/O）', en: 'Prefer async (async void / sync I/O)' },
  R3: { 'zh-TW': '減少 out 參數', en: 'Avoid out parameters' },
  R4: { 'zh-TW': '資源與執行緒誤用（new HttpClient／Thread.Sleep）', en: 'Resource/thread misuse (new HttpClient / Thread.Sleep)' },
  R5: { 'zh-TW': 'catch 吞掉例外（未記錄也未重拋）', en: 'Swallowed exception (no log, no rethrow)' },
  R6: { 'zh-TW': '檔案編碼規範', en: 'File encoding hygiene' },
};

const M = {
  'R1.getResult': {
    'zh-TW': '禁止 .GetAwaiter().GetResult()：會阻塞執行緒並可能死結，請改用 await。',
    en: 'Avoid .GetAwaiter().GetResult(): it blocks the thread and can deadlock; use await.',
  },
  'R1.result': {
    'zh-TW': '禁止對 Task 使用 .Result（{expr}）：會阻塞並可能死結，請改用 await。',
    en: 'Avoid .Result on a Task ({expr}): it blocks and can deadlock; use await.',
  },
  'R1.wait': {
    'zh-TW': '禁止對 Task 使用 .Wait()（{expr}）：請改用 await。',
    en: 'Avoid .Wait() on a Task ({expr}); use await.',
  },
  'R1.waitAll': {
    'zh-TW': '禁止 {expr}：請改用 await {alt}。',
    en: 'Avoid {expr}; use await {alt}.',
  },
  'R2.asyncVoid': {
    'zh-TW': '方法 {name} 為 async void：例外無法被呼叫端捕捉，請改為 async Task（事件處理常式除外）。',
    en: 'Method {name} is async void: exceptions cannot be observed by callers; return Task instead (event handlers excepted).',
  },
  'R2.syncIo': {
    'zh-TW': '公開方法 {method} 同步呼叫 I/O：{call}，已有非同步版本 {alt}。',
    en: 'Public method {method} performs synchronous I/O: {call}; an async variant exists: {alt}.',
  },
  'R3.out': {
    'zh-TW': '方法 {name} 使用 out 參數（{params}）：建議改回傳 tuple 或結果物件。',
    en: 'Method {name} uses out parameter(s) ({params}); prefer returning a tuple or result object.',
  },
  'R4.httpClient': {
    'zh-TW': '在方法內 new HttpClient()：每次建立會耗盡 socket，請改用 IHttpClientFactory 或共用的 static 執行個體。',
    en: 'new HttpClient() inside a method causes socket exhaustion; use IHttpClientFactory or a shared static instance.',
  },
  'R4.threadSleep': {
    'zh-TW': '在 async 方法 {name} 中呼叫 Thread.Sleep：會阻塞執行緒，請改用 await Task.Delay(...)。',
    en: 'Thread.Sleep inside async method {name} blocks a thread; use await Task.Delay(...).',
  },
  'R5.swallow': {
    'zh-TW': 'catch（{type}）吞掉例外：既未記錄日誌也未重新拋出。',
    en: 'catch ({type}) swallows the exception: it neither logs nor rethrows.',
  },
  'R6.ascii': {
    'zh-TW': '{ext} 檔必須是純 ASCII（cmd.exe 以系統字碼頁 CP950 讀取），第一個非 ASCII 位元組 0x{byte}。',
    en: '{ext} files must be pure ASCII (cmd.exe reads them in the OEM code page); first non-ASCII byte 0x{byte}.',
  },
  'R6.bom': {
    'zh-TW': '{ext} 含非 ASCII 字元但沒有 UTF-8 BOM：Windows PowerShell 5.1 會以 ANSI（CP950）誤讀。',
    en: '{ext} contains non-ASCII characters but has no UTF-8 BOM: Windows PowerShell 5.1 will misread it as ANSI.',
  },
  'R6.utf8': {
    'zh-TW': '{ext} 必須是有效的 UTF-8（偏移 {offset} 處位元組 0x{byte} 無效，可能是 Big5／CP950）。',
    en: '{ext} must be valid UTF-8 (invalid byte 0x{byte} at offset {offset}; Big5/CP950?).',
  },
  'R6.bomForbidden': {
    'zh-TW': '{ext} 應為 UTF-8（無 BOM）。',
    en: '{ext} should be UTF-8 without BOM.',
  },
  'R6.fffd': {
    'zh-TW': '檔案含 U+FFFD 取代字元（先前的轉碼已遺失資料）。',
    en: 'File contains U+FFFD replacement characters (data lost by an earlier mis-decode).',
  },
};

export function fmt(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

/** Returns { 'zh-TW': ..., en: ... } */
export function message(key, params) {
  const m = M[key];
  if (!m) throw new Error(`missing message ${key}`);
  return Object.fromEntries(LANGS.map(l => [l, fmt(m[l], params)]));
}

const UI = {
  'zh-TW': {
    summary: '共 {total} 項：錯誤 {error}、警告 {warning}、提示 {note}（掃描 {files} 個檔案，{ms} ms）',
    noFindings: '沒有發現問題。',
    suggestion: '建議改寫',
    suppressed: '已抑制 {n} 項（csrules-disable 註解）',
    allowed: '已依允許清單略過 {n} 項',
  },
  en: {
    summary: '{total} finding(s): {error} error(s), {warning} warning(s), {note} note(s) ({files} files scanned, {ms} ms)',
    noFindings: 'No findings.',
    suggestion: 'Suggested rewrite',
    suppressed: '{n} suppressed (csrules-disable comments)',
    allowed: '{n} skipped by allowlist',
  },
};

export function ui(lang, key, params) {
  return fmt((UI[lang] || UI.en)[key], params);
}
