# 04-otel-trace-viewer

完全在本機執行的 OpenTelemetry 分散式追蹤範例：三個以官方 OpenTelemetry JS SDK 儀表化的 Node 服務（gateway → orders → pricing，含 SQLite 與 fetch）、自製 OTLP/HTTP JSON 收集器（SQLite 儲存）、瀑布圖檢視器（繁體中文 / English、淺色 / 深色）、日誌與 trace 關聯、負載產生器。

**完整說明請開啟 [README.html](README.html)**（分頁：概覽、快速開始、使用說明、逐步驗證指南、開發者指南、除錯與日誌、限制與疑難排解、English）。

快速開始（需要 Node.js 22.13 以上）：

```
npm ci
npm start -- --load 30        # Windows：setup.bat 後執行 start.bat
# 瀏覽器開啟 http://127.0.0.1:4318/
npm run loadgen -- --count 50  # Windows：loadgen.bat
npm test                       # 需要 Playwright Chromium（npx playwright install chromium）
```

截圖：[examples/](examples/)

English: fully local OpenTelemetry tracing demo (instrumented Node services, a tiny OTLP/HTTP JSON collector backed by SQLite, and a trace viewer UI with waterfall, span details and correlated logs). See README.html, tab "English".
