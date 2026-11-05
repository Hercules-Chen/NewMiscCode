# 09 視覺回歸測試（Rust 影像比對核心 + WebAssembly）

完整說明請開啟 **[README.html](README.html)**（分頁：概覽、快速開始、使用說明、逐步驗證指南、開發者指南、效能比較、除錯與日誌、限制與疑難排解、English）。

- Rust crate `crate/`（PNG 解碼、YIQ + 反鋸齒比對、忽略區域、紅框聚類）→ `web/vr_core.wasm`（raw `extern "C"`，無 wasm-bindgen）
- Node CLI：`node src/cli.js compare|run|approve|serve|bench`；Windows：`setup.bat`、`run-demo.bat`、`serve-ui.bat`、`run-tests.bat`
- 瀏覽器 UI：`npm run serve` → http://127.0.0.1:5179/（繁中預設、可切換英文、`?debug=1`）
- 驗證：`npm run test:rust`、`npm test`

English: Rust image-diff core compiled to WebAssembly, used by a Node CLI (Playwright screenshots + self-contained HTML report), a browser UI and a native CLI. See README.html → "English".
