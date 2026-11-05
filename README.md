# NewMiscCode 新技術實驗

完整說明請開 [README.html](README.html)（有分頁導覽）。

| 資料夾 | 技術 | 說明 |
|---|---|---|
| [01-mcp-ui-verifier](01-mcp-ui-verifier/README.html) | MCP + Playwright | UI 自動驗證，錯誤截圖紅框標示，HTML 報告 |
| [02-local-semantic-search](02-local-semantic-search/README.html) | transformers.js + SQLite FTS5 + sqlite-vec | 完全本機的中英文混合語意搜尋 |
| [03-duckdb-wasm-dashboard](03-duckdb-wasm-dashboard/README.html) | DuckDB-WASM | 零後端瀏覽器 SQL 分析與 Log 範本 |

各資料夾：`npm install && npm test`。編碼稽核：`node tools/audit-text.mjs`。
