# Playwright 端對端測試

Playwright 可以驅動 Chromium、Firefox、WebKit 做瀏覽器自動化。

## 基本流程

```js
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8787/');
await page.fill('#q', 'hello');
await page.screenshot({ path: 'shot.png' });
```

## 小技巧

- `page.waitForSelector('.result')` 等待非同步渲染完成，不要用固定 sleep。
- `page.on('console', m => console.log(m.text()))` 把網頁 console 印到終端機。
- 企業內網沒有外網時，可設定 `PLAYWRIGHT_BROWSERS_PATH` 指向事先複製好的瀏覽器資料夾。
- 截圖前設定固定 viewport，避免 CI 產生的畫面大小不一致。
