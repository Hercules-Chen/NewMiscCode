# 06 - 編碼醫生 Encoding Doctor (Go → WebAssembly + CLI)

文字編碼診斷與修復：Big5/CP950 vs UTF-8、BOM、CRLF/LF、U+FFFD、亂碼還原，並依檔案類型檢查規則（.bat ASCII + CRLF、.ps1 UTF-8 BOM、.md/.json/.js/.html UTF-8 無 BOM）。
同一份 Go 程式碼編譯成瀏覽器 WebAssembly 介面與原生 CLI `encdoc`（含 Windows exe）。

完整說明（含逐步驗證指南、編碼知識速查）請開啟 **[README.html](README.html)**. Full documentation: **README.html** (English summary tab included).

```
npm run build     # web/encdoc.wasm + web/wasm_exec.js + bin/encdoc (needs Go 1.24+)
npm start         # http://127.0.0.1:8706/   (?debug=1)
bin/encdoc --fix testdata      # dry-run fix plan; add --apply to write
npm test          # build + go test + CLI checks + Playwright e2e
```

Windows: `start-windows.bat`（介面）、`build-windows.bat`（建置）、`encdoc-scan.bat`（CLI）。

注意：`testdata/` 是故意壞掉的範例檔（Big5、BOM、中文 .bat…），文字稽核請排除此資料夾。
