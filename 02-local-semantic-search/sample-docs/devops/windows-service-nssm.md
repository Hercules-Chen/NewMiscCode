# 把 Node.js 程式註冊成 Windows 服務

使用 NSSM（Non-Sucking Service Manager）：

```
nssm install MySearch "C:\Program Files\nodejs\node.exe" "C:\apps\search\src\cli.js serve"
nssm set MySearch AppDirectory C:\apps\search
nssm set MySearch AppStdout C:\ProgramData\MySearch\logs\stdout.log
```

注意服務預設以 LocalSystem 執行，存取網路磁碟或使用者憑證存放區會失敗，必要時改成指定帳號。
資料與記錄檔建議放在 %ProgramData%，不要寫到 Program Files。
