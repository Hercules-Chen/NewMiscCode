# 03 - DuckDB-WASM 資料分析台 (DuckDB-WASM Data Desk)

純瀏覽器、零後端的資料分析工具（拖放 CSV / JSON / JSONL / XLSX / Parquet，SQL、圖表、匯出、Log 分析預設）。
Zero-backend, in-browser data analysis with DuckDB-WASM 1.32.0.

完整說明（含逐步驗證指南）請開啟 **[README.html](README.html)**. Full documentation: **README.html**.

```
npm install
npm run build   # public/vendor/ (wasm, not committed) + dist/artifact.html
npm start       # http://127.0.0.1:8703/   (?debug=1)
npm test        # Playwright end-to-end test
```

Windows: double-click `start-windows.bat`.
