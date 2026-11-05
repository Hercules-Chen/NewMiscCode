// End-to-end: record interactions on 01-mcp-ui-verifier's demo site (programmatic API + toolbar),
// validate with 01's own validateScenario, then replay with 01's CLI and expect exit code 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startRecorder } from '../src/recorder.js';
import { PROJECT_ROOT, VERIFIER_ROOT } from '../src/config.js';
import { startVerifierDemo, chromium, replayWith01, runNode, TEST_OUT } from './helpers.js';

const { validateScenario } = await import(pathToFileURL(path.join(VERIFIER_ROOT, 'src', 'scenario.js')).href);
const EXAMPLES = path.join(PROJECT_ROOT, 'examples');

test('record demo site via API + toolbar, validate with 01, replay with 01 CLI (exit 0)', { timeout: 120000 }, async () => {
  const srv = await startVerifierDemo();
  const browser = await chromium().launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    const rec = await startRecorder(page, { lang: 'zh-TW', name: 'demo-login-recorded', debounceMs: 150 });
    await page.goto(srv.url);
    const bar = (act) => page.locator(`[data-uirec-act=${act}]`);
    await bar('stop').waitFor();
    assert.equal(await bar('stop').innerText(), '停止並儲存');
    assert.equal(await bar('toggle').innerText(), '暫停');

    // Language toggle (toolbar click must not be recorded).
    await bar('lang').click();
    assert.equal(await bar('stop').innerText(), 'Stop & save');
    assert.equal(await bar('assert').innerText(), 'Add assertion');
    await bar('lang').click();
    assert.equal(await bar('stop').innerText(), '停止並儲存');

    // Pause: interactions while paused are not recorded.
    await bar('toggle').click();
    assert.equal(await bar('toggle').innerText(), '開始');
    await page.click('#title');
    await bar('toggle').click();
    assert.equal(await bar('toggle').innerText(), '暫停');

    await page.fill('#username', '小明');
    await page.fill('#password', 'secret123');
    await page.click('#login-btn');
    await page.locator('#login-msg').filter({ hasText: '歡迎' }).waitFor();
    await rec.flush();

    // Assertion mode: next click picks an element instead of clicking it.
    await bar('assert').click();
    assert.equal(await bar('assert').innerText(), '點選要斷言的元素…');
    await page.click('#login-msg');
    await rec.flush();

    // Annotate mode: pick #price and #add-to-cart (its handler would throw if the click leaked through).
    await bar('annotate').click();
    await page.click('#price');
    await page.click('#add-to-cart');
    assert.equal(await bar('annotate').innerText(), '完成標註 (2)');
    await page.screenshot({ path: path.join(EXAMPLES, 'toolbar-annotate-zh-TW.png') });
    await bar('annotate').click();
    await rec.flush();

    // Mobile width: toolbar wraps, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 700 });
    await bar('lang').click();
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.equal(hscroll, false, 'no horizontal scroll at 390px');
    await page.screenshot({ path: path.join(EXAMPLES, 'toolbar-en-390.png') });

    await bar('stop').click();
    assert.equal(await rec.waitForStop(), 'toolbar');
    const sc = rec.scenario();

    assert.deepEqual(sc.steps.map((s) => s.action), ['open', 'fill', 'fill', 'click', 'assert_text', 'screenshot_annotate']);
    assert.deepEqual(sc.steps[0], { action: 'open', url: '/' });
    assert.deepEqual(sc.steps[1], { action: 'fill', selector: '#username', text: '小明' });
    assert.deepEqual(sc.steps[2], { action: 'fill', selector: '#password', text: 'secret123', secret: true });
    assert.deepEqual(sc.steps[3], { action: 'click', selector: '#login-btn' });
    assert.equal(sc.steps[4].selector, '#login-msg');
    assert.match(sc.steps[4].expected, /^歡迎，小明/);
    assert.deepEqual(sc.steps[5].selectors, ['#price', '#add-to-cart']);
    assert.equal(sc.baseUrl, srv.url);
    assert.ok(!JSON.stringify(sc).includes('uirec'), 'toolbar elements never appear in steps');
    assert.ok(!sc.steps.some((s) => s.selector === '#title'), 'paused click not recorded');
    assert.deepEqual(errors, [], 'no console errors during recording');

    validateScenario(sc, 'recorded'); // throws on invalid format

    await fsp.mkdir(TEST_OUT, { recursive: true });
    const file = path.join(TEST_OUT, 'demo-recorded.json');
    await fsp.writeFile(file, JSON.stringify(sc, null, 2) + '\n', 'utf8');
    const res = await replayWith01(file, srv.url);
    assert.equal(res.code, 0, `01 replay failed:\n${res.out}`);
    assert.match(res.out, /6 (通過|passed)/);

    // Stable example for the docs (baseUrl = default port of `serve-demo`).
    const example = { ...sc, baseUrl: 'http://127.0.0.1:4173/', recordedAt: '2026-11-05T00:00:00.000Z' };
    await fsp.writeFile(path.join(EXAMPLES, 'demo-recorded.json'), JSON.stringify(example, null, 2) + '\n', 'utf8');
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('CLI record --script (headless) writes a valid scenario that 01 replays with exit 0', { timeout: 120000 }, async () => {
  const srv = await startVerifierDemo();
  try {
    const out = path.join(TEST_OUT, 'cli-script.json');
    const r = await runNode(['src/cli.js', 'record', srv.url, '--script', 'test/fixtures/demo-steps.js', '--out', out, '--lang', 'en', '--check-console'], { env: { UIREC_OUTPUT_DIR: TEST_OUT } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Scenario saved \(6 steps\)/);
    const sc = JSON.parse(await fsp.readFile(out, 'utf8'));
    validateScenario(sc, out);
    assert.deepEqual(sc.steps.map((s) => s.action), ['open', 'fill', 'fill', 'click', 'assert_text', 'check_console_errors']);
    const logFile = r.out.match(/Log: (.+\.jsonl)/)[1].trim();
    const lines = (await fsp.readFile(logFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.every((l) => l.ts && l.level && l.event), 'JSONL lines have ts/level/event');
    assert.ok(!lines.some((l) => JSON.stringify(l).includes('secret123')), 'password never written to the log');
    const res = await replayWith01(out, srv.url);
    assert.equal(res.code, 0, res.out);
  } finally {
    await srv.close();
  }
});
