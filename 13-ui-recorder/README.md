# 13-ui-recorder：UI 錄製器 / UI recorder

在真實瀏覽器操作一次，錄成 [01-mcp-ui-verifier](../01-mcp-ui-verifier/README.md) 可直接執行的情境 JSON。
Record real browser interactions into a scenario JSON that 01-mcp-ui-verifier runs unchanged.

完整說明（分頁：概覽、快速開始、使用說明、逐步驗證指南、開發者指南、除錯與日誌、限制、English）：**[README.html](README.html)**

```bash
npm test                                          # 需要 ../01-mcp-ui-verifier（示範網站、validateScenario、重播）
npm run record:demo                               # 錄製 01 的示範商店（有視窗）
node src/cli.js record http://localhost:5000/ --out my.json [--lang en] [--debug]
node src/cli.js record <url> --script steps.js --out my.json    # 腳本模式（無頭）
node ../01-mcp-ui-verifier/src/cli.js run my.json --base-url http://localhost:5000/
```

Windows：`setup.bat`、`record-demo.bat`、`record.bat <url> --out my.json`、`run-tests.bat`（.bat → ui-recorder.ps1 → node）。
輸出與 JSONL 日誌：Windows `%ProgramData%\NewMiscCode\13-ui-recorder`，Linux `./output`。

- 工具列：開始/暫停、加入斷言、截圖標註、停止並儲存、EN/中（工具列點擊不會被錄）
- 選擇器：`#id` → `[data-testid]` → `[name]` → `role=…[name="…"]` → `text=` → 短 CSS 路徑，皆以 Playwright 驗證唯一
- API：`startRecorder(page)` → `flush()` / `stop()` / `waitForStop()` / `scenario()`
- 相依：Node 20+、Playwright（全域或 01 的 node_modules），無 npm 套件
