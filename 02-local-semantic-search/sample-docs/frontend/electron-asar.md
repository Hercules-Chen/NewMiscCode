# Electron ASAR 打包注意事項

Electron 會把應用程式原始碼打包成 `app.asar` 封存檔，讀取速度快，也避免 Windows 路徑過長。

## 原生模組

`.node` 原生模組（例如 better-sqlite3、sqlite-vec）不能從 asar 內直接載入，需要在 electron-builder 設定：

```json
{ "asarUnpack": ["**/*.node", "**/node_modules/sqlite-vec-*/**"] }
```

解出來的檔案會在 `app.asar.unpacked` 目錄。

## 其他

- ASAR 不是加密，任何人都能用 `npx @electron/asar extract app.asar out` 解開。
- 原生模組要針對 Electron 的 ABI 重新編譯：`npx @electron/rebuild`。
- 子程序 `child_process.spawn` 無法執行 asar 內的 exe，要放在 unpacked 目錄。
