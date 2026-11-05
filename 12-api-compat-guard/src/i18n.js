// 介面字串（zh-TW / en）。 UI strings.
export const STR = {
  'zh-TW': {
    title_diff: 'OpenAPI 相容性報告', title_replay: '流量重播相容性報告',
    BREAKING: '破壞性', NON_BREAKING: '非破壞性', INFO: '資訊', OK: '相容',
    summary: '摘要', changes: '變更清單', exchanges: '請求比對', raw: '除錯 / 原始資料',
    rule: '規則', severity: '嚴重度', location: '位置', field: '欄位', message: '說明', old: '舊', new: '新',
    method: '方法', url: 'URL', status: '狀態碼', diffs: '差異數', filter: '篩選', all: '全部',
    generated: '產生時間', inputs: '輸入', verdict_fail: '發現破壞性變更：不可直接上線', verdict_ok: '未發現破壞性變更',
    none: '（沒有項目）', lang: 'English', exit_code: '結束代碼',
    usage: `用法：
  apiguard diff <old.yaml|json> <new.yaml|json> [--format console|json|md|html] [--out 檔案] [--fail-on breaking|none]
  apiguard record --target http://舊服務 [--port 9000] [--out recordings.jsonl]
  apiguard replay --to http://新服務 <recordings.jsonl> [--format ...] [--out 檔案]
  apiguard mock <spec.yaml> [--port 4010]
  apiguard rules            列出相容性規則
共用選項：--lang zh-TW|en  --config apiguard.config.json  --data-dir 路徑  --debug
結束代碼：0 = 相容；1 = 發現破壞性變更；2 = 使用錯誤或執行失敗`,
    rec_listening: '錄製代理已啟動：http://127.0.0.1:{port} -> {target}，寫入 {out}（Ctrl+C 結束）',
    rec_stopped: '已停止，共錄製 {n} 筆。',
    report_written: '報告已寫入：{file}', log_file: '日誌：{file}',
    mock_listening: 'Mock 伺服器：http://127.0.0.1:{port}（{n} 個操作）'
  },
  en: {
    title_diff: 'OpenAPI compatibility report', title_replay: 'Traffic replay compatibility report',
    BREAKING: 'Breaking', NON_BREAKING: 'Non-breaking', INFO: 'Info', OK: 'Compatible',
    summary: 'Summary', changes: 'Changes', exchanges: 'Exchanges', raw: 'Debug / raw',
    rule: 'Rule', severity: 'Severity', location: 'Location', field: 'Field', message: 'Message', old: 'Old', new: 'New',
    method: 'Method', url: 'URL', status: 'Status', diffs: 'Diffs', filter: 'Filter', all: 'All',
    generated: 'Generated', inputs: 'Inputs', verdict_fail: 'Breaking changes found: do not release as-is', verdict_ok: 'No breaking changes found',
    none: '(none)', lang: '中文', exit_code: 'Exit code',
    usage: `Usage:
  apiguard diff <old.yaml|json> <new.yaml|json> [--format console|json|md|html] [--out file] [--fail-on breaking|none]
  apiguard record --target http://old-service [--port 9000] [--out recordings.jsonl]
  apiguard replay --to http://new-service <recordings.jsonl> [--format ...] [--out file]
  apiguard mock <spec.yaml> [--port 4010]
  apiguard rules            list compatibility rules
Common: --lang zh-TW|en  --config apiguard.config.json  --data-dir path  --debug
Exit codes: 0 = compatible; 1 = breaking changes; 2 = usage error or failure`,
    rec_listening: 'Recording proxy on http://127.0.0.1:{port} -> {target}, writing {out} (Ctrl+C to stop)',
    rec_stopped: 'Stopped; {n} exchanges recorded.',
    report_written: 'Report written: {file}', log_file: 'Log: {file}',
    mock_listening: 'Mock server: http://127.0.0.1:{port} ({n} operations)'
  }
};

export function t(lang, key, params = {}) {
  const s = (STR[lang] || STR['zh-TW'])[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? `{${k}}` : String(params[k])));
}
