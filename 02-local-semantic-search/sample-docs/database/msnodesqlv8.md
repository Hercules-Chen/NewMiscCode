# msnodesqlv8 連接 SQL Server

msnodesqlv8 是透過 Microsoft ODBC Driver 的 Node.js 原生模組，只支援 Windows 與 Linux。

## 連線字串範例

```
Driver={ODBC Driver 18 for SQL Server};Server=localhost\SQLEXPRESS;Database=Demo;Trusted_Connection=yes;TrustServerCertificate=yes;
```

## 連線失敗排查

1. 確認 SQL Server Browser 服務已啟動（具名執行個體需要）。
2. ODBC Driver 18 預設 Encrypt=yes，自簽憑證要加 TrustServerCertificate=yes，否則會出現 SSL 憑證鏈錯誤。
3. 防火牆開放 TCP 1433。
4. Node 版本升級後出現 `was compiled against a different Node.js version`：執行 `npm rebuild msnodesqlv8`。

## 非同步查詢

使用 `sql.promises.query(conn, 'select 1 as x')` 取得 Promise 版 API，避免 callback 地獄。
