# 用 Volta 固定 Node 版本

原生模組（better-sqlite3、msnodesqlv8、sqlite-vec）是針對特定 Node ABI 編譯的。
同事電腦 Node 版本不同時，常見錯誤：

```
Error: The module '...better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115.
```

## 作法

1. 安裝 Volta：`winget install Volta.Volta`
2. 專案目錄執行 `volta pin node@22`，會寫入 package.json 的 `volta` 欄位。
3. 切換版本後執行 `npm rebuild` 重新取得 prebuild。

nvm-windows 也可以，但需要手動切換，容易忘記。
