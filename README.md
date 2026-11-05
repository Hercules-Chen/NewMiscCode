# NewMiscCode 新技術實驗

完整總覽與交接文件請開 [README.html](README.html)（分頁：快速開始、環境需求、網路需求、Port 與資料位置、Windows 實機驗證清單、設計決策、驗證紀錄、疑難排解、文件維護規範）。

| # | 資料夾 | 技術 | 說明 |
|---|---|---|---|
| 01 | [01-mcp-ui-verifier](01-mcp-ui-verifier/README.html) | MCP + Playwright | UI 自動驗證，錯誤截圖紅框標示，HTML 報告 |
| 02 | [02-local-semantic-search](02-local-semantic-search/README.html) | transformers.js + SQLite FTS5 + sqlite-vec | 完全本機的中英文混合語意搜尋 |
| 03 | [03-duckdb-wasm-dashboard](03-duckdb-wasm-dashboard/README.html) | DuckDB-WASM | 零後端瀏覽器 SQL 分析與 Log 範本 |
| 04 | [04-otel-trace-viewer](04-otel-trace-viewer/README.html) | OpenTelemetry | 分散式追蹤、自製 collector 與瀑布圖 |
| 05 | [05-crdt-collab](05-crdt-collab/README.html) | Yjs CRDT | 多人即時協作，離線編輯自動合併 |
| 06 | [06-encoding-doctor-wasm](06-encoding-doctor-wasm/README.html) | Go → WASM | 編碼醫生：Big5 / UTF-8 / BOM / CRLF / 亂碼診斷修復 |
| 07 | [07-passkeys-webauthn](07-passkeys-webauthn/README.html) | WebAuthn | Passkeys 免密碼登入 |
| 08 | [08-pwa-offline-sync](08-pwa-offline-sync/README.html) | Service Worker | 離線優先 PWA 與同步 |
| 09 | [09-visual-regression-rust-wasm](09-visual-regression-rust-wasm/README.html) | Rust → WASM | 截圖像素比對，紅框標示差異 |
| 10 | [10-durable-workflow](10-durable-workflow/README.html) | 事件溯源 + node:sqlite | 當機可續跑的工作流程引擎 |
| 11 | [11-csharp-rules-treesitter](11-csharp-rules-treesitter/README.html) | tree-sitter | C# 團隊規則檢查（SARIF 輸出） |
| 12 | [12-api-compat-guard](12-api-compat-guard/README.html) | OpenAPI | API 相容性守門員 |

需求：Node 22.13 以上。全部測試：`verify-all.bat` 或 `node tools/verify-all.mjs`。
文件檢查：`node tools/audit-text.mjs` 與 `node tools/check-docs.mjs`。
