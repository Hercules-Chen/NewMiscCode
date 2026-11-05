# PowerShell 與 cmd 的中文編碼

繁體中文 Windows 的 cmd 預設代碼頁是 950（Big5）。

- `.bat` 檔最好只用 ASCII 字元，避免在 950 代碼頁下變成亂碼。
- Windows PowerShell 5.1 讀取沒有 BOM 的 `.ps1` 會當成 ANSI（Big5），所以含中文的 `.ps1` 要存成 **UTF-8 with BOM**。
- 輸出 UTF-8：`[Console]::OutputEncoding = [Text.Encoding]::UTF8` 或 `chcp 65001`。
- PowerShell 7 預設 UTF-8 無 BOM，行為不同，要注意相容性。
