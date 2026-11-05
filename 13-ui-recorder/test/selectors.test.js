// Selector strategy and event-capture rules on a local fixture page.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startRecorder } from '../src/recorder.js';
import { localValidate } from '../src/validate.js';
import { serveDir, chromium, FIXTURES } from './helpers.js';

test('selector priority: #id > data-testid > name > role+name > text > CSS path, all unique', { timeout: 60000 }, async () => {
  const srv = await serveDir(path.join(FIXTURES, 'site'));
  const browser = await chromium().launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const rec = await startRecorder(page, { lang: 'en', debounceMs: 100, navGraceMs: 300 });
    await page.goto(srv.url);
    await page.locator('[data-uirec-act=stop]').waitFor();
    await page.click('#ok-id');
    await page.click('[data-testid=save-btn]');
    await page.fill('input[name=email]', 'a@b.tw');
    await page.locator('#dup').nth(1).click();
    await page.click('.tag');
    await page.locator('.cell').nth(1).click();
    await page.click('text=同意 Agree'); // label click -> recorded once, on the checkbox
    await page.fill('#q', '筆電');
    await page.press('#q', 'Enter'); // Enter + implicit submit click -> only "press" is recorded
    await page.locator('#out').filter({ hasText: '筆電' }).waitFor();
    await rec.flush();
    const steps = rec.steps.slice(1); // skip "open"
    const sels = steps.map((s) => `${s.action}:${s.selector}`);
    assert.deepEqual(sels, [
      'click:#ok-id',
      'click:[data-testid="save-btn"]',
      'fill:input[name="email"]',
      'click:role=button[name="乙 Second"]',
      'click:text="標籤 A"',
      'click:div.grid > div.cell:nth-of-type(2)',
      'click:#agree',
      'fill:#q',
      'press:#q',
    ]);
    for (const s of steps) assert.equal(await page.locator(s.selector).count(), 1, `${s.selector} is unique`);
    assert.equal(steps.at(-1).key, 'Enter');

    // Link navigation is recorded as a click only; toolbar + language survive the navigation.
    await page.locator('[data-uirec-act=lang]').click();
    await page.click('#go');
    await page.waitForURL(/page2/);
    await page.locator('[data-uirec-act=stop]').waitFor();
    assert.equal(await page.locator('[data-uirec-act=stop]').innerText(), '停止並儲存');
    await page.waitForTimeout(400);
    // Typed URL (no preceding action) -> recorded as "open".
    await page.goto(srv.url + '?again=1');
    await rec.flush();
    const tail = rec.steps.slice(-2);
    assert.deepEqual(tail, [{ action: 'click', selector: '#go' }, { action: 'open', url: '/?again=1' }]);
    const sc = await rec.stop();
    localValidate(sc);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
