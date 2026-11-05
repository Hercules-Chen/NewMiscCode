# csrules：以 tree-sitter（WASM）檢查 C# 團隊程式規則

不需要 .NET SDK 的 C# 規則檢查器：Node.js + `web-tree-sitter` 0.25.10 + `tree-sitter-c-sharp` 0.23.5（wasm，ABI 15）。
規則：R1 禁止 sync-over-async、R2 優先 async、R3 減少 out 參數、R4 `new HttpClient()` / async 中的 `Thread.Sleep`、R5 catch 吞例外、R6 檔案編碼。
輸出：主控台、JSON、SARIF 2.1.0、自帶 HTML 報告（繁體中文 / English）。

**完整說明請開啟 [README.html](README.html)**（分頁：概覽、規則一覽、快速開始、使用說明、逐步驗證指南、開發者指南、與 Roslyn Analyzer 比較、除錯與日誌、限制與疑難排解、English）。

快速開始：

```
npm ci
npm test
node src/cli.js samples --fix-suggestions --html output/report.html --sarif output/report.sarif
```

Windows：雙擊 `setup.bat`，再雙擊 `run-sample.bat`；檢查自己的專案用 `csrules.bat <資料夾>`。

注意：`samples/encoding-bad/` 內的檔案刻意違反編碼規範（R6 測試資料），儲存庫編碼稽核請排除此資料夾。

English: a C# team-rule linter on web-tree-sitter (no .NET SDK). See README.html, tab "English".
