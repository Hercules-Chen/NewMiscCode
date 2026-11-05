# mcp-ui-verifier

用真實瀏覽器（Playwright + Chromium）驗證網頁 UI 的 MCP 伺服器與 CLI：紅框標註截圖、自帶 HTML 報告（繁體中文 / English）、JSONL 日誌、Playwright trace。

**完整說明請開啟 [README.html](README.html)**（分頁：安裝、逐步驗證指南、註冊到 Claude Code、MCP 工具、情境 JSON、CLI 選項、除錯與日誌、Windows 啟動器、限制）。

快速開始：

```
npm install
npx playwright install chromium
npm test
node src/cli.js demo
```

註冊到 Claude Code：

```
claude mcp add ui-verifier -- node <絕對路徑>/01-mcp-ui-verifier/src/server.js --lang zh-TW
```

範例報告：[examples/report.html](examples/report.html)

English: an MCP server (stdio) + CLI that drives a real Chromium via Playwright to verify web UIs, producing red-box annotated screenshots and a self-contained HTML report. See README.html (tab "English").
