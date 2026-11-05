---
title: SQL Server Always Encrypted 實務筆記
tags: [sqlserver, security]
---
# SQL Server Always Encrypted 實務筆記

Always Encrypted（一律加密）讓敏感資料行在用戶端就完成加解密，SQL Server 引擎本身看不到明文。

## 金鑰架構

- 資料行主要金鑰（CMK）：通常放在 Windows 憑證存放區（CurrentUser/My 或 LocalMachine/My）或 Azure Key Vault。
- 資料行加密金鑰（CEK）：由 CMK 保護，存在資料庫中繼資料。
- 確定性（Deterministic）可做等值查詢；隨機（Randomized）較安全但不能查詢。

## 用戶端設定

連接字串必須加上 `Column Encryption Setting=Enabled`，驅動程式才會自動解密。
ODBC 則是 `ColumnEncryption=Enabled`，需要 ODBC Driver 17 以上。

## 常見錯誤

- `Operand type clash: varchar is incompatible with varchar(50) encrypted with ...`：參數沒有用參數化查詢，或型別長度不一致。
- 「找不到憑證，無法解密資料行加密金鑰」：執行服務的帳號沒有存取 CMK 憑證的私密金鑰權限，請在 certlm.msc 管理私密金鑰。
- 讀出來是一串 varbinary：連接字串少了加密設定。

相關：[[msnodesqlv8 連接 SQL Server]]
