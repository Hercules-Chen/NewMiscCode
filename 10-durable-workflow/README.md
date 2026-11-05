# 10-durable-workflow：Durable Workflow 引擎

用 Node.js 22 內建 `node:sqlite` 實作的小型 durable execution 引擎（概念同 Temporal / Azure Durable Functions）：事件歷程 + 重播、耐久計時器、外部訊號、重試退避、Saga 補償、非決定性偵測、崩潰復原；附網頁儀表板（繁中 / English）、REST API 與 CLI（`wf start / signal / status / worker`）。

**完整說明請開啟 [README.html](README.html)**（分頁：概覽、核心概念、快速開始、使用說明、逐步驗證指南、開發者指南、與 Durable Functions / Temporal 對照、除錯與日誌、限制與疑難排解、English）。

快速開始（不需要 `npm install`，沒有執行期相依套件）：

```
node bin/wf.mjs serve          # 儀表板 http://127.0.0.1:8710/ + 內嵌 worker
node bin/wf.mjs start leave-approval
node bin/wf.mjs status
npm test
```

Windows：雙擊 `start-dashboard.bat`；命令列用 `wf.bat`。

English: a small durable-execution workflow engine (event-sourced history + replay, durable timers, signals, retries, saga, non-determinism detection, crash recovery) on Node 22 + SQLite, with a web dashboard, REST API and CLI. See README.html (tab "English").
