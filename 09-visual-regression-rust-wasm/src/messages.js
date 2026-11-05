// messages.js - CLI messages (zh-TW default, en via --lang en or VR_LANG=en).
export const CLI_MSG = {
  'zh-TW': {
    usage: `用法 / Usage:
  vr compare <baseline.png> <current.png> [--out diff.png] [--threshold 0.1] [--ignore x,y,w,h]... [--aa] [--gap 8] [--json]
  vr run     [--config demo/vr.config.json] [--site <資料夾或網址>] [--baseline-dir DIR] [--threshold 0.1] [--ignore x,y,w,h]
  vr approve [--name <頁面名稱>]...      將 current 升級為 baseline
  vr serve   [--port 5179]               啟動瀏覽器 UI（http://127.0.0.1:5179/）
  vr bench   [a.png b.png] [--iter 10]   WASM 與原生（native）效能比較
共用選項：--out-dir DIR（預設 Windows: %ProgramData%\\NewMiscCode\\09-visual-regression-rust-wasm；Linux: ./output）
          --debug（JSONL 除錯日誌）  --lang zh-TW|en
結束碼：0 = 無差異/成功，1 = 有差異或新增頁面，2 = 錯誤`,
    same: '相同（在門檻值內）', changed: '有差異', diffWritten: '差異圖已寫入', report: '報告', approved: '已升級為基準', none: '沒有可升級的 current 截圖', serving: '瀏覽器 UI 已啟動', stop: '按 Ctrl+C 停止', log: '日誌', error: '錯誤',
  },
  en: {
    usage: `Usage:
  vr compare <baseline.png> <current.png> [--out diff.png] [--threshold 0.1] [--ignore x,y,w,h]... [--aa] [--gap 8] [--json]
  vr run     [--config demo/vr.config.json] [--site <dir or url>] [--baseline-dir DIR] [--threshold 0.1] [--ignore x,y,w,h]
  vr approve [--name <page>]...           promote current screenshots to baseline
  vr serve   [--port 5179]                start the browser UI (http://127.0.0.1:5179/)
  vr bench   [a.png b.png] [--iter 10]    WASM vs native timing
Common: --out-dir DIR (default Windows: %ProgramData%\\NewMiscCode\\09-visual-regression-rust-wasm; Linux: ./output)
        --debug (JSONL debug log)  --lang zh-TW|en
Exit codes: 0 = no diff / ok, 1 = diff or new pages, 2 = error`,
    same: 'identical (within threshold)', changed: 'changed', diffWritten: 'diff written', report: 'report', approved: 'promoted to baseline', none: 'no current screenshots to approve', serving: 'browser UI running', stop: 'press Ctrl+C to stop', log: 'log', error: 'error',
  },
};
