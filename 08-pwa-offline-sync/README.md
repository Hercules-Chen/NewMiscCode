# 08 · PWA Offline Sync 離線優先巡檢紀錄

完整說明（分頁導覽、逐步驗證、開發者指南、English summary）請開 [README.html](README.html)。

- 手寫 Service Worker（版本化 precache、SWR、network-first、更新橫幅）＋ IndexedDB outbox ＋ Background Sync
- Idempotency-Key 保證重送不重複；版本號衝突偵測，UI 選「保留我的 / 採用對方」
- Node ≥ 22.13，零執行期相依（`node:http` + `node:sqlite`）

```
start.bat            # Windows：啟動 http://localhost:8808/
npm start            # Linux/macOS（或 ./start.sh）
npm install && npm test   # 11 項伺服器測試 + 9 項 Playwright e2e
```
