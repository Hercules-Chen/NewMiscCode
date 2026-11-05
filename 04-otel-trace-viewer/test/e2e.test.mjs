// End-to-end test: real collector + 3 instrumented services on random ports, real traffic,
// assertions on stored spans/logs, then Playwright drives the viewer UI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startStack } from '../src/start-all.mjs';
import { runLoad } from '../src/loadgen.mjs';

const require = createRequire(import.meta.url);
const EXAMPLES = fileURLToPath(new URL('../examples/', import.meta.url));
const SLOW_MS = 800;
let stack;
let dataDir;
const ids = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => { const r = await fetch(url); assert.equal(r.status, 200, `${url} -> ${r.status}`); return r.json(); };

async function call(path) {
  const r = await fetch(stack.gatewayUrl + path);
  await r.arrayBuffer();
  const traceId = r.headers.get('x-trace-id');
  assert.match(traceId || '', /^[0-9a-f]{32}$/, `x-trace-id header for ${path}`);
  return { status: r.status, traceId };
}

/** Poll the collector until a trace has at least minSpans spans (batch export is asynchronous). */
async function waitTrace(traceId, minSpans, timeoutMs = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${stack.collectorUrl}/api/traces/${traceId}`);
    if (r.status === 200) { last = await r.json(); if (last.spans.length >= minSpans) return last; }
    await sleep(200);
  }
  throw new Error(`trace ${traceId} has ${last ? last.spans.length : 0} spans, expected >= ${minSpans}`);
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'otv-test-'));
  stack = await startStack({ dataDir, logDir: join(dataDir, 'logs'), quiet: true });
  const checkout = await call('/api/checkout?item=widget&qty=2');
  assert.equal(checkout.status, 201);
  ids.checkout = checkout.traceId;
  const slow = await call(`/api/slow?ms=${SLOW_MS}`);
  assert.equal(slow.status, 200);
  ids.slow = slow.traceId;
  const err = await call('/api/error');
  assert.equal(err.status, 502);
  ids.error = err.traceId;
  const unknown = await call('/api/checkout?item=unobtainium&qty=1');
  assert.equal(unknown.status, 422);
  ids.unknown = unknown.traceId;
  const load = await runLoad({ gatewayUrl: stack.gatewayUrl, count: 12, concurrency: 3, slowMs: 300 });
  assert.equal(load.failed, 0);
});

after(async () => {
  if (stack) await stack.stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test('W3C trace context propagates gateway -> orders -> pricing with correct parent/child links', async () => {
  const t = await waitTrace(ids.checkout, 9);
  const spans = t.spans;
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  assert.ok(spans.every((s) => s.trace_id === ids.checkout), 'all spans share the trace id');
  assert.deepEqual([...new Set(spans.map((s) => s.service))].sort(), ['gateway', 'orders', 'pricing']);
  const roots = spans.filter((s) => !s.parent_span_id);
  assert.equal(roots.length, 1, 'exactly one root span');
  assert.equal(roots[0].service, 'gateway');
  assert.equal(roots[0].kind, 2, 'root is a SERVER span');
  assert.equal(roots[0].name, 'GET /api/checkout');
  for (const s of spans) if (s.parent_span_id) assert.ok(byId.has(s.parent_span_id), `parent of ${s.name} exists in trace`);

  const ordersServer = spans.find((s) => s.service === 'orders' && s.kind === 2);
  const gwClient = byId.get(ordersServer.parent_span_id);
  assert.equal(gwClient.service, 'gateway');
  assert.equal(gwClient.kind, 3, 'orders SERVER span is child of gateway CLIENT (fetch) span');
  assert.equal(byId.get(gwClient.parent_span_id).name, 'checkout.handle', 'fetch happened inside manual span');

  const pricingServer = spans.find((s) => s.service === 'pricing' && s.kind === 2);
  const ordersClient = byId.get(pricingServer.parent_span_id);
  assert.equal(ordersClient.service, 'orders');
  assert.equal(ordersClient.kind, 3);
  assert.equal(byId.get(ordersClient.parent_span_id).name, 'orders.create');

  const create = spans.find((s) => s.name === 'orders.create');
  assert.equal(create.attributes['app.item'], 'widget');
  assert.equal(create.attributes['app.qty'], 2);
  assert.deepEqual(create.events.map((e) => e.name), ['validation.passed', 'price.received', 'order.persisted']);
  const insert = spans.find((s) => s.name === 'INSERT orders');
  assert.equal(insert.attributes['db.system.name'], 'sqlite');
  assert.equal(insert.parent_span_id, create.span_id);
  assert.ok(spans.every((s) => s.status_code !== 2), 'no error spans in checkout trace');
});

test('error path: exception recorded and ERROR status on failing spans up to the root', async () => {
  const t = await waitTrace(ids.error, 5);
  const charge = t.spans.find((s) => s.name === 'orders.charge');
  assert.equal(charge.status_code, 2);
  assert.match(charge.status_message, /payment provider timeout/);
  const exc = charge.events.find((e) => e.name === 'exception');
  assert.ok(exc, 'exception event recorded');
  assert.match(exc.attributes['exception.message'], /payment provider timeout/);
  const ordersServer = t.spans.find((s) => s.service === 'orders' && s.kind === 2);
  assert.equal(ordersServer.status_code, 2);
  assert.equal(ordersServer.attributes['http.response.status_code'], 500);
  const root = t.spans.find((s) => !s.parent_span_id);
  assert.equal(root.status_code, 2, 'gateway root marked as error');

  const unknown = await waitTrace(ids.unknown, 7);
  const lookup = unknown.spans.find((s) => s.name === 'pricing.lookup');
  assert.equal(lookup.status_code, 2);
  assert.ok(lookup.events.some((e) => e.name === 'catalog.miss'));
});

test('slow path: span durations reflect the deliberate delay; list filters work', async () => {
  const t = await waitTrace(ids.slow, 7);
  const agg = t.spans.find((s) => s.name === 'report.aggregate');
  assert.ok(agg.duration_us >= SLOW_MS * 1000, `report.aggregate ${agg.duration_us}us >= ${SLOW_MS}ms`);
  const root = t.spans.find((s) => !s.parent_span_id);
  assert.ok(root.duration_us >= agg.duration_us, 'root encloses child');
  assert.ok(t.spans.find((s) => s.name === 'orders.report').events.some((e) => e.name === 'report.slow'));

  const slowList = await getJson(`${stack.collectorUrl}/api/traces?minDurationMs=${SLOW_MS - 50}`);
  assert.ok(slowList.some((x) => x.trace_id === ids.slow));
  assert.ok(slowList.every((x) => x.duration_us >= (SLOW_MS - 50) * 1000));
  const errList = await getJson(`${stack.collectorUrl}/api/traces?status=error`);
  assert.ok(errList.some((x) => x.trace_id === ids.error));
  assert.ok(errList.every((x) => x.error_count > 0));
  const okList = await getJson(`${stack.collectorUrl}/api/traces?status=ok&service=pricing`);
  assert.ok(okList.some((x) => x.trace_id === ids.checkout));
  assert.ok(okList.every((x) => x.error_count === 0 && x.services.includes('pricing')));
  const recent = await getJson(`${stack.collectorUrl}/api/traces?sinceMinutes=5&q=checkout`);
  assert.ok(recent.length >= 1 && recent.every((x) => x.root_name.includes('checkout')));
});

test('logs are correlated with trace_id/span_id (collector + JSONL files)', async () => {
  const t = await waitTrace(ids.checkout, 9);
  let logs = t.logs;
  for (let i = 0; i < 30 && !logs.some((l) => l.service === 'orders'); i++) { await sleep(200); logs = (await waitTrace(ids.checkout, 9)).logs; }
  const create = t.spans.find((s) => s.name === 'orders.create');
  const orderLog = logs.find((l) => l.body === 'order created');
  assert.ok(orderLog, 'order created log shipped to collector');
  assert.equal(orderLog.span_id, create.span_id);
  assert.equal(orderLog.attributes.item, 'widget');
  const spanLogs = await getJson(`${stack.collectorUrl}/api/logs?traceId=${ids.checkout}&spanId=${create.span_id}`);
  assert.ok(spanLogs.length >= 1);

  const files = await readdir(join(dataDir, 'logs'));
  for (const f of ['gateway.jsonl', 'orders.jsonl', 'pricing.jsonl', 'collector.jsonl']) assert.ok(files.includes(f), `${f} exists`);
  const lines = (await readFile(join(dataDir, 'logs', 'orders.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const rec = lines.find((l) => l.msg === 'order created');
  assert.equal(rec.trace_id, ids.checkout);
  assert.equal(rec.level, 'info');
});

test('dependencies, stats and OTLP edge cases', async () => {
  const deps = await getJson(`${stack.collectorUrl}/api/dependencies`);
  const edge = (a, b) => deps.find((d) => d.source === a && d.target === b);
  assert.ok(edge('gateway', 'orders')?.calls >= 3);
  assert.ok(edge('orders', 'pricing')?.calls >= 1);
  assert.ok(edge('gateway', 'orders').errors >= 1);
  // 4 scripted requests + 12 load-generator requests = 16 traces (export is batched, so poll briefly).
  let stats;
  for (let i = 0; i < 50; i++) { stats = await getJson(`${stack.collectorUrl}/api/stats`); if (stats.traces >= 16) break; await sleep(200); }
  assert.ok(stats.spans > 30 && stats.traces >= 16, JSON.stringify(stats));

  const proto = await fetch(`${stack.collectorUrl}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: new Uint8Array([1, 2, 3]) });
  assert.equal(proto.status, 415);
  const bad = await fetch(`${stack.collectorUrl}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  // Hand-written OTLP JSON (base64 ids, as some SDKs send) is accepted and normalized to hex.
  const tid = Buffer.from('0af7651916cd43dd8448eb211c80319c', 'hex').toString('base64');
  const sid = Buffer.from('b7ad6b7169203331', 'hex').toString('base64');
  const ok = await fetch(`${stack.collectorUrl}/v1/traces`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'manual' } }] }, scopeSpans: [{ scope: { name: 't' }, spans: [{ traceId: tid, spanId: sid, name: 'hand-made', kind: 1, startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000000250000000', attributes: [{ key: 'n', value: { intValue: '7' } }], status: { code: 1 } }] }] }] }),
  });
  assert.equal(ok.status, 200);
  const manual = await getJson(`${stack.collectorUrl}/api/traces/0af7651916cd43dd8448eb211c80319c`);
  assert.equal(manual.spans[0].span_id, 'b7ad6b7169203331');
  assert.equal(manual.spans[0].duration_us, 250000);
  assert.equal(manual.spans[0].attributes.n, 7);
});

test('viewer UI (Playwright): list, waterfall, span detail, logs, language toggle, 390px layout', async () => {
  await waitTrace(ids.checkout, 9);
  await waitTrace(ids.error, 5);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const problems = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1, colorScheme: 'light' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(stack.collectorUrl + '/');
    await page.locator(`tr[data-trace="${ids.checkout}"]`).waitFor();
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hant-TW');
    assert.equal(await page.locator('#listView h2').first().textContent(), '追蹤清單');
    assert.ok(await page.locator('#depGraph svg .node').count() >= 3, 'dependency graph has 3+ nodes');
    // Filter by status=error narrows the list.
    await page.selectOption('#fStatus', 'error');
    await page.waitForFunction(() => [...document.querySelectorAll('tr[data-trace]')].every((r) => r.classList.contains('is-error')));
    await page.selectOption('#fStatus', '');
    await page.locator(`tr[data-trace="${ids.checkout}"]`).waitFor();
    await mkdir(EXAMPLES, { recursive: true });
    await page.screenshot({ path: join(EXAMPLES, '01-trace-list.png') });

    await page.click(`tr[data-trace="${ids.checkout}"]`);
    await page.locator('[data-testid="waterfall-row"]').first().waitFor();
    assert.equal(await page.locator('[data-testid="waterfall-row"]').count(), 9, 'one waterfall row per span');
    assert.equal(await page.locator('[data-testid="trace-id"]').textContent(), ids.checkout);
    const createRow = page.locator('[data-testid="waterfall-row"]', { hasText: 'orders.create' });
    await createRow.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="detail-name"]')?.textContent.includes('orders.create'));
    const attrs = await page.locator('[data-testid="detail-attributes"]').textContent();
    assert.match(attrs, /app\.item/);
    assert.match(attrs, /widget/);
    assert.match(await page.locator('[data-testid="detail-events"]').textContent(), /order\.persisted/);
    assert.match(await page.locator('[data-testid="detail-logs"]').textContent(), /order created/);
    assert.match(page.url(), /\?span=[0-9a-f]{16}$/);
    // Collapse the orders SERVER span -> its descendants disappear.
    await page.locator('[data-testid="waterfall-row"]', { hasText: 'POST /orders' }).locator('.twisty').click();
    assert.equal(await page.locator('[data-testid="waterfall-row"]').count(), 4);
    await page.click('#expandAll');
    assert.equal(await page.locator('[data-testid="waterfall-row"]').count(), 9);
    await createRow.click();
    await page.screenshot({ path: join(EXAMPLES, '02-waterfall-detail.png') });

    // Error trace + language toggle + dark theme.
    await page.goto(`${stack.collectorUrl}/#/trace/${ids.error}`);
    await page.locator('[data-testid="waterfall-row"]').first().waitFor();
    await page.locator('[data-testid="waterfall-row"]', { hasText: 'orders.charge' }).click();
    await page.locator('[data-testid="detail-exception"]').waitFor();
    assert.match(await page.locator('[data-testid="detail-logs"]').textContent(), /charge failed/);
    assert.match(await page.locator('[data-testid="detail-status"]').textContent(), /錯誤/);
    assert.equal(await page.locator('.back').textContent(), '← 返回清單');
    await page.click('[data-testid="lang-toggle"]');
    assert.equal(await page.locator('.back').textContent(), '← Back to list');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    assert.match(await page.locator('[data-testid="detail-status"]').textContent(), /Error/);
    await page.click('[data-testid="theme-toggle"]');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.screenshot({ path: join(EXAMPLES, '03-error-trace-en-dark.png') });
    // Language persists across reload.
    await page.reload();
    await page.locator('[data-testid="waterfall-row"]').first().waitFor();
    assert.equal(await page.locator('.back').textContent(), '← Back to list');
    await ctx.close();

    // 390px wide: no horizontal scroll on list and trace views.
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const m = await mctx.newPage();
    m.on('console', (msg) => { if (msg.type() === 'error') problems.push(`mobile console: ${msg.text()}`); });
    m.on('pageerror', (e) => problems.push(`mobile pageerror: ${e.message}`));
    await m.goto(stack.collectorUrl + '/');
    await m.locator(`tr[data-trace="${ids.checkout}"]`).waitFor();
    const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(await overflow() <= 0, `list view overflows by ${await overflow()}px`);
    await m.goto(`${stack.collectorUrl}/#/trace/${ids.checkout}`);
    await m.locator('[data-testid="waterfall-row"]').first().waitFor();
    assert.ok(await overflow() <= 0, `trace view overflows by ${await overflow()}px`);
    await mctx.close();
  } finally {
    await browser.close();
  }
  assert.deepEqual(problems, [], 'no console errors');
});

test('README.html renders without console errors and without horizontal scroll at 390px', async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
    const readme = new URL('../README.html', import.meta.url).href;
    const tabs = await (async () => { await page.goto(readme); return page.$$eval('nav.tabs a', (as) => as.map((a) => a.dataset.tab)); })();
    assert.ok(tabs.length >= 8, 'README has 8+ tabs');
    for (const tab of tabs) {
      await page.goto(`${readme}#${tab}`);
      assert.ok(await page.locator(`section#${tab}.active`).isVisible(), `tab ${tab} visible`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `README tab ${tab} overflows by ${overflow}px`);
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(problems, []);
});
