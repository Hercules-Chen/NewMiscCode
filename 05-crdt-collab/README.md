# crdt-collab（05）

以 **Yjs CRDT** 打造的離線優先即時協作 App：共享 Markdown 筆記 + 共享任務板、遠端游標與在線狀態、只撤銷自己修改的復原、自架 WebSocket 同步伺服器（磁碟 append log + 快照持久化）、IndexedDB 離線編輯與重新連線自動合併、版本歷史、繁體中文 / English、淺色 / 深色。

**完整說明請開啟 [README.html](README.html)**（分頁：概覽、快速開始、使用說明、逐步驗證指南、開發者指南、除錯與日誌、限制與疑難排解、English）。

快速開始：

```
npm ci
npm run build
npm start          # http://127.0.0.1:8705/?room=demo
npm test           # 7 個 Node 測試 + 12 個 Playwright 端對端測試
```

Windows：雙擊 `run-server.bat`（啟動並開啟瀏覽器）、`run-debug.bat`（詳細日誌）、`run-tests.bat`（測試）。
資料與日誌預設位置：Windows `%ProgramData%\NewMiscCode\05-crdt-collab`，其他系統 `./data`。

截圖：[examples/two-users.png](examples/two-users.png)、[examples/offline-pending.png](examples/offline-pending.png)、[examples/history.png](examples/history.png)、[examples/mobile-dark-en.png](examples/mobile-dark-en.png)

English: a local-first collaborative notes + task board app on Yjs with its own Node WebSocket sync server (y-protocols, disk persistence), offline support via y-indexeddb, presence/remote cursors, undo, and version history. See README.html (tab "English").
