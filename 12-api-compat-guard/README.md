# API 相容性守門員 apiguard（12-api-compat-guard）

改寫程式時確保 Web API 輸入/輸出與原本相容：OpenAPI 3.x 差異比對（BREAKING / NON_BREAKING / INFO）＋ 流量錄製重播契約測試 ＋ Mock 伺服器。報告支援 中文 / English。

完整說明（概覽、規則表、快速開始、使用說明、逐步驗證、開發者指南、ASP.NET Core 整合、除錯、限制）請開啟 **[README.html](README.html)**。

```
npm install
npm test
npm run demo
node src/cli.js diff demo/openapi-v1.yaml demo/openapi-v2.yaml --out report.html
```

Windows：`setup.bat` → `run-demo.bat` / `run-tests.bat` / `apiguard.bat diff old.yaml new.yaml`。

English: see the "English" tab in README.html.
