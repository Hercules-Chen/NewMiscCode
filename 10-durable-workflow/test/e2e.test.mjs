// Dashboard end-to-end test with Playwright (Chromium). Skipped if playwright is not installed.
// Saves small screenshots into examples/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { demoWorkflows } from '../src/workflows/index.js';
import { defineWorkflow } from '../src/engine.js';
import { createApp, listen } from '../src/server.js';
import { tempDir, makeEngine, startWorker, waitTerminal, waitForStatus } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = join(ROOT, 'examples');
let pw = null;
try { pw = createRequire(import.meta.url)('playwright'); } catch { pw = null; }

const tmp = tempDir('wf-e2e-');
after(() => tmp.cleanup());

test('dashboard: list runs, filter, timeline, approve via UI, non-determinism banner, language/theme toggle, 390px, no console errors', { skip: !pw && 'playwright not installed (npm i -D playwright)', timeout: 90000 }, async () => {
  // a run started with "v1" code, then the code changes incompatibly -> non-determinism shown in the UI
  const v1 = defineWorkflow({ name: 'evolving', async handler(ctx) { await ctx.step('reserve', async () => 1); await ctx.waitForSignal('go'); return 'v1'; } });
  const v2 = defineWorkflow({ name: 'evolving', async handler(ctx) { await ctx.step('validate', async () => 0); await ctx.waitForSignal('go'); return 'v2'; } });
  const e0 = makeEngine(join(tmp.dir, 'e2e.db'), [v1]); const w0 = startWorker(e0);
  e0.start('evolving', {}, { runId: 'evolving-1' });
  await waitForStatus(e0, 'evolving-1', 'waiting');
  await w0.stop(); e0.close();
  const engine = makeEngine(join(tmp.dir, 'e2e.db'), [...demoWorkflows, v2]);
  const worker = startWorker(engine);
  const server = createApp({ engine, worker, logger: engine.log.root });
  const port = await listen(server, 0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}/`;
  mkdirSync(EXAMPLES, { recursive: true });

  // some history to look at
  const ok = engine.start('order-saga', { orderId: 'SO-1001', sku: 'NB-14', qty: 2, amount: 52000, simulate: { chargeFailures: 1, delayMs: 20 } }, { runId: 'order-SO-1001' });
  const comp = engine.start('order-saga', { orderId: 'SO-1002', sku: 'NB-14', qty: 1, amount: 26000, simulate: { shipFails: true, delayMs: 20 } }, { runId: 'order-SO-1002' });
  const leave = engine.start('leave-approval', { employee: '王小明', days: 2, reason: '家庭因素', approver: '陳經理', escalateTo: '林協理', timeoutMs: 600000 }, { runId: 'leave-0001' });
  engine.signal('evolving-1', 'go', {});
  await waitTerminal(engine, ok.id); await waitTerminal(engine, comp.id); await waitTerminal(engine, 'evolving-1');

  const browser = await pw.chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(base);
    await page.waitForSelector('[data-testid=run-row]');
    assert.ok(await page.locator('[data-testid=run-row]').count() >= 3, 'runs listed');
    assert.equal(await page.locator('header .brand').textContent(), 'Durable Workflow 儀表板', 'zh-TW default');
    // status filter
    await page.click('[data-testid=filter-waiting]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=run-row]').length === 1);
    await page.click('[data-filter=""]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=run-row]').length >= 3);
    await page.screenshot({ path: join(EXAMPLES, '01-runs-list.png') });

    // open the leave-approval run detail
    await page.click('tr[data-run="leave-0001"]');
    await page.waitForSelector('[data-testid=timeline] [data-type=SignalWaitStarted]');
    assert.match(await page.locator('[data-testid=run-status]').textContent(), /等待中/);
    // approve via UI
    await page.click('[data-testid=approve-btn]');
    await page.waitForSelector('[data-testid=run-status] [data-status=completed]', { timeout: 15000 });
    await page.waitForSelector('[data-testid=timeline] [data-type=WorkflowCompleted]');
    const result = JSON.parse(await page.locator('[data-testid=run-result]').textContent());
    assert.equal(result.approved, true);
    assert.equal(engine.store.getRun('leave-0001').status, 'completed');
    await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await page.screenshot({ path: join(EXAMPLES, '02-run-detail-approved.png') });

    // language toggle -> English
    await page.click('[data-testid=lang-toggle]');
    await page.waitForFunction(() => document.querySelector('header .brand').textContent === 'Durable Workflow Dashboard');
    await page.waitForFunction(() => /Event history/.test(document.querySelector('[data-testid=timeline] h2').textContent));
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');

    // non-determinism banner
    await page.goto(base + '#/run/evolving-1');
    await page.waitForSelector('[data-testid=nd-banner]');
    assert.match(await page.locator('[data-testid=nd-banner]').textContent(), /Non-determinism detected[\s\S]*seq 1: history recorded step "reserve" but workflow code now calls step "validate"/);

    // theme toggle cycles auto -> light -> dark
    await page.click('[data-testid=theme-toggle]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.click('[data-testid=theme-toggle]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');

    // compensated saga run, mobile width + dark theme, English
    const mobile = await browser.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    mobile.on('pageerror', e => errors.push('pageerror(mobile): ' + e.message));
    mobile.on('console', m => { if (m.type() === 'error') errors.push('console(mobile): ' + m.text()); });
    await mobile.goto(base + '?lang=en#/run/order-SO-1002');
    await mobile.waitForSelector('[data-testid=timeline] [data-type=WorkflowCompleted]');
    assert.equal(await mobile.locator('[data-testid=timeline] [data-type=StepFailed]').count(), 1);
    const hscroll = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.equal(hscroll, false, 'no horizontal scroll at 390px');
    await mobile.locator('[data-testid=timeline]').scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: join(EXAMPLES, '03-mobile-dark-en-saga.png') });
    await mobile.goto(base + '#/debug');
    await mobile.waitForSelector('[data-testid=logs-card] .log-line');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, 'debug view fits 390px');
  } finally {
    await browser.close();
    server.close();
    await worker.stop();
    engine.close();
  }
  assert.deepEqual(errors, [], 'no console errors');
});
