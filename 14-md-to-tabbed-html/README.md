# Markdown 分頁文件產生器 md2tabs（14-md-to-tabbed-html）

把 Markdown 轉成「每個 `## ` 一個分頁、`### ` 可深連結、深色模式、可列印」的單一自包含 HTML（UTF-8 無 BOM、原子寫入、`--check` 自我驗證）。CLI 訊息支援 中文 / English。

完整說明請開啟 **[README.html](README.html)**。它是由本工具從 **[docs/README.md](docs/README.md)** 產生的（dogfooding）：要修改說明請改 `docs/README.md`，再執行 `npm run build:docs`，不要手改 README.html。本檔只是簡短指引，不是產生器的輸入（避免 GitHub 首頁顯示一份與 HTML 重複、又容易不同步的長文件）。

```
npm install
npm test
npm run build:docs
node src/cli.js build guide.md --out guide.html --check
```

Windows：`setup.bat` → `build-docs.bat` / `run-tests.bat` / `md2tabs.bat build guide.md --check`。

English: see the "English" tab in README.html.
