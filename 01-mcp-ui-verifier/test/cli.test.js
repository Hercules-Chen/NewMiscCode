// CLI end-to-end test: run the demo, then open the generated report in Chromium and check it renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startDemoServer } from '../demo/server.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.js');

test('cli demo produces report, screenshots and JSONL log (zh-TW)', async () => {
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'uiv-cli-'));
  const { stdout } = await run(process.execPath, [CLI, 'demo', '--out', out, '--timeout', '1500', '--trace']);
  assert.match(stdout, /完成：10 通過 \/ 4 失敗/);
  const reportPath = stdout.match(/報告：(.+report\.html)/)[1].trim();
  const runDir = path.dirname(reportPath);
  assert.ok(fs.existsSync(path.join(runDir, 'trace.zip')), 'trace.zip written');
  const shots = await fsp.readdir(path.join(runDir, 'screenshots'));
  assert.equal(shots.length, 5);
  const log = (await fsp.readFile(path.join(runDir, 'log.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((r) => r.msg === 'step.end' && r.status === 'fail'));
  assert.ok(log.every((r) => r.ts && r.level));

  // Render the report in a real browser and click through the tabs.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    await page.goto(pathToFileURL(reportPath).href);
    assert.equal(await page.locator('h1').innerText(), 'UI 驗證報告');
    assert.ok(await page.locator('#summary').isVisible());
    assert.match(await page.locator('.overall').innerText(), /有失敗項目/);
    await page.click('nav.tabs a[data-tab="steps"]');
    assert.ok(await page.locator('#steps').isVisible());
    assert.equal(await page.locator('#steps tbody tr.row-fail').count(), 4);
    await page.click('nav.tabs a[data-tab="screenshots"]');
    const imgs = page.locator('#screenshots figure img');
    assert.equal(await imgs.count(), 5);
    const w = await imgs.first().evaluate((img) => img.naturalWidth);
    assert.ok(w >= 1280, 'embedded image decodes');
    await page.click('nav.tabs a[data-tab="console"]');
    assert.match(await page.locator('#console').innerText(), /TypeError/);
    // Anchor deep link from the summary to a step
    await page.goto(pathToFileURL(reportPath).href + '#step-9');
    assert.ok(await page.locator('#steps').isVisible());
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('cli run exits 1 on failures and 0 on success, --lang en', async () => {
  const demo = await startDemoServer(0);
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'uiv-cli2-'));
  try {
    const failRun = await run(process.execPath, [CLI, 'run', path.join(ROOT, 'scenarios', 'demo.json'), '--base-url', demo.url, '--out', out, '--lang', 'en', '--timeout', '800']).then(
      () => ({ code: 0 }),
      (e) => ({ code: e.code, stdout: e.stdout }),
    );
    assert.equal(failRun.code, 1);
    assert.match(failRun.stdout, /Done: 10 passed \/ 4 failed/);
    const passRun = await run(process.execPath, [CLI, 'run', path.join(ROOT, 'scenarios', 'demo-pass.json'), '--base-url', demo.url, '--out', out, '--lang', 'en']);
    assert.match(passRun.stdout, /0 failed/);
  } finally {
    await demo.close();
  }
});

test('cli without args prints usage and exits 2', async () => {
  const r = await run(process.execPath, [CLI]).then(() => ({ code: 0 }), (e) => ({ code: e.code, stdout: e.stdout }));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /node src\/cli\.js run/);
});
