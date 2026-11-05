// Engine semantics: replay, durable timers, signals, retries, saga, non-determinism, cancel.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { defineWorkflow } from '../src/engine.js';
import { NonRetryableError } from '../src/errors.js';
import { demoWorkflows } from '../src/workflows/index.js';
import { tempDir, makeEngine, startWorker, sleep, waitFor, waitForStatus, waitTerminal, eventTypes } from './helpers.mjs';

const tmp = tempDir();
after(() => tmp.cleanup());
let dbN = 0;
const newDb = () => join(tmp.dir, `t${++dbN}.db`);

describe('replay', () => {
  test('each step runs exactly once although the workflow function is replayed several times', async () => {
    const effects = { a: 0, b: 0, c: 0 };
    let invocations = 0;
    const wf = defineWorkflow({
      name: 'replay-count',
      async handler(ctx) {
        invocations++;
        const a = await ctx.step('a', async () => { effects.a++; return { v: 1 }; });
        await ctx.sleep(50);
        const b = await ctx.step('b', async () => { effects.b++; return a.v + 1; });
        const sig = await ctx.waitForSignal('go');
        const c = await ctx.step('c', async () => { effects.c++; return b + sig.add; });
        const r = await ctx.random();
        return { c, rIsNumber: typeof r === 'number' };
      },
    });
    const engine = makeEngine(newDb(), [wf]);
    const worker = startWorker(engine);
    const run = engine.start('replay-count', {});
    await waitForStatus(engine, run.id, 'waiting');
    await sleep(100); // let the timer fire and the run reach waitForSignal
    await waitFor(() => engine.store.getRun(run.id).waiting_on?.some(w => w.kind === 'signal'));
    engine.signal(run.id, 'go', { add: 40 });
    const done = await waitTerminal(engine, run.id);
    await worker.stop(); engine.close();
    assert.equal(done.status, 'completed');
    assert.deepEqual(done.result, { c: 42, rIsNumber: true });
    assert.deepEqual(effects, { a: 1, b: 1, c: 1 }, 'side effects executed exactly once');
    assert.ok(invocations >= 3, `workflow function replayed (invocations=${invocations})`);
  });
});


describe('durable timer', () => {
  test('sleep survives a worker/engine restart and fires after its due time', async () => {
    const db = newDb();
    const effects = [];
    const mk = () => defineWorkflow({
      name: 'sleepy',
      async handler(ctx) {
        await ctx.step('before', async () => { effects.push('before'); });
        await ctx.sleep(700);
        await ctx.step('after', async () => { effects.push('after'); return Date.now(); });
        return 'ok';
      },
    });
    const e1 = makeEngine(db, [mk()]);
    const w1 = startWorker(e1);
    const run = e1.start('sleepy', {});
    await waitForStatus(e1, run.id, 'waiting');
    const fireAt = e1.store.timers(run.id)[0].fire_at;
    await w1.stop(); e1.close(); // "process exit" while the timer is pending
    await sleep(200);
    const e2 = makeEngine(db, [mk()]);
    assert.equal(e2.store.getRun(run.id).status, 'waiting', 'still waiting after restart');
    const w2 = startWorker(e2);
    const done = await waitTerminal(e2, run.id);
    const afterAt = e2.store.history(run.id).find(e => e.type === 'StepCompleted' && e.name === 'after').ts;
    await w2.stop(); e2.close();
    assert.equal(done.status, 'completed');
    assert.ok(afterAt >= fireAt, 'step after the sleep ran no earlier than the timer due time');
    assert.deepEqual(effects, ['before', 'after']);
  });
});

describe('signals', () => {
  const wf = defineWorkflow({
    name: 'approval-lite',
    async handler(ctx, input) {
      try { const p = await ctx.waitForSignal('approval', { timeout: input.timeout }); return { decision: p }; } catch (e) { if (e.name === 'TimeoutError') return { decision: 'timeout' }; throw e; }
    },
  });
  test('signal delivered before the timeout resolves the wait with its payload', async () => {
    const engine = makeEngine(newDb(), [wf]); const worker = startWorker(engine);
    const run = engine.start('approval-lite', { timeout: 5000 });
    await waitForStatus(engine, run.id, 'waiting');
    engine.signal(run.id, 'approval', { approved: true, by: 'boss' });
    const done = await waitTerminal(engine, run.id);
    assert.deepEqual(done.result, { decision: { approved: true, by: 'boss' } });
    assert.equal(engine.store.timers(run.id)[0].status, 'cancelled', 'timeout timer cancelled');
    await worker.stop(); engine.close();
  });
  test('timeout fires when no signal arrives', async () => {
    const engine = makeEngine(newDb(), [wf]); const worker = startWorker(engine);
    const run = engine.start('approval-lite', { timeout: 250 });
    const done = await waitTerminal(engine, run.id);
    assert.deepEqual(done.result, { decision: 'timeout' });
    assert.ok(eventTypes(engine, run.id).includes('SignalTimedOut:approval'));
    await worker.stop(); engine.close();
  });
  test('signal sent before the workflow waits is buffered', async () => {
    const engine = makeEngine(newDb(), [wf]);
    const run = engine.start('approval-lite', { timeout: 5000 });
    engine.signal(run.id, 'approval', 'early');
    const worker = startWorker(engine);
    const done = await waitTerminal(engine, run.id);
    assert.deepEqual(done.result, { decision: 'early' });
    await worker.stop(); engine.close();
  });
  test('leave-approval demo escalates after timeout then accepts approval', async () => {
    const engine = makeEngine(newDb(), demoWorkflows); const worker = startWorker(engine);
    const run = engine.start('leave-approval', { employee: 'A', days: 1, approver: 'B', escalateTo: 'C', timeoutMs: 200, escalationTimeoutMs: 5000 });
    await waitFor(() => eventTypes(engine, run.id).includes('StepCompleted:escalate'), { msg: 'escalation' });
    engine.signal(run.id, 'approval', { approved: true, by: 'C' });
    const done = await waitTerminal(engine, run.id);
    assert.equal(done.result.approved, true);
    assert.equal(done.result.escalated, true);
    await worker.stop(); engine.close();
  });
});

describe('retries', () => {
  test('exponential backoff between attempts, then success', async () => {
    let calls = 0;
    const wf = defineWorkflow({
      name: 'flaky',
      async handler(ctx) {
        return ctx.step('flakyCall', async a => { calls++; if (a.attempt < 3) throw new Error('transient ' + a.attempt); return 'ok@' + a.attempt; },
          { retry: { maxAttempts: 5, initialIntervalMs: 100, backoffCoefficient: 2 } });
      },
    });
    const engine = makeEngine(newDb(), [wf]); const worker = startWorker(engine);
    const run = engine.start('flaky', {});
    const done = await waitTerminal(engine, run.id);
    const hist = engine.store.history(run.id);
    await worker.stop(); engine.close();
    assert.equal(done.status, 'completed');
    assert.equal(done.result, 'ok@3');
    assert.equal(calls, 3);
    const starts = hist.filter(e => e.type === 'StepStarted').map(e => e.ts);
    const fails = hist.filter(e => e.type === 'StepAttemptFailed').map(e => e.data.delayMs);
    assert.deepEqual(fails, [100, 200], 'delays double');
    assert.ok(starts[1] - starts[0] >= 95, `gap1 ${starts[1] - starts[0]}`);
    assert.ok(starts[2] - starts[1] >= 195, `gap2 ${starts[2] - starts[1]}`);
  });
  test('non-retryable error fails immediately; exhausted retries surface StepFailedError', async () => {
    let n1 = 0, n2 = 0;
    const wf = defineWorkflow({
      name: 'nonretry',
      async handler(ctx, input) {
        if (input.mode === 'nonretry') return ctx.step('bad', async () => { n1++; throw new NonRetryableError('invalid card'); }, { retry: { maxAttempts: 5, initialIntervalMs: 10 } });
        return ctx.step('always', async () => { n2++; throw new Error('down'); }, { retry: { maxAttempts: 2, initialIntervalMs: 10 } });
      },
    });
    const engine = makeEngine(newDb(), [wf]); const worker = startWorker(engine);
    const r1 = engine.start('nonretry', { mode: 'nonretry' });
    const r2 = engine.start('nonretry', { mode: 'exhaust' });
    const d1 = await waitTerminal(engine, r1.id); const d2 = await waitTerminal(engine, r2.id);
    await worker.stop(); engine.close();
    assert.equal(d1.status, 'failed'); assert.equal(n1, 1); assert.equal(d1.error.name, 'StepFailedError');
    assert.equal(d2.status, 'failed'); assert.equal(n2, 2); assert.match(d2.error.message, /after 2 attempt/);
  });
});

describe('saga', () => {
  test('order-saga compensates in reverse order when shipping fails', async () => {
    const engine = makeEngine(newDb(), demoWorkflows); const worker = startWorker(engine);
    const run = engine.start('order-saga', { orderId: 'SO-9', sku: 'X', qty: 1, amount: 100, simulate: { shipFails: true, delayMs: 5 } });
    const done = await waitTerminal(engine, run.id);
    const completed = engine.store.history(run.id).filter(e => e.type === 'StepCompleted').map(e => e.name);
    await worker.stop(); engine.close();
    assert.equal(done.status, 'completed');
    assert.equal(done.result.status, 'compensated');
    assert.deepEqual(completed, ['reserveStock', 'chargePayment', 'refundPayment', 'releaseStock']);
    assert.deepEqual(done.result.compensated, ['refundPayment', 'releaseStock']);
  });
  test('order-saga happy path with one transient charge failure', async () => {
    const engine = makeEngine(newDb(), demoWorkflows); const worker = startWorker(engine);
    const run = engine.start('order-saga', { orderId: 'SO-10', sku: 'X', qty: 1, amount: 100, simulate: { chargeFailures: 1, delayMs: 5 } });
    const done = await waitTerminal(engine, run.id);
    await worker.stop(); engine.close();
    assert.equal(done.result.status, 'shipped');
  });
});

describe('non-determinism', () => {
  test('changing step order in code while a run is in flight is detected and reported', async () => {
    const db = newDb();
    const v1 = defineWorkflow({ name: 'evolving', async handler(ctx) { await ctx.step('reserve', async () => 1); await ctx.waitForSignal('go'); await ctx.step('charge', async () => 2); return 'v1'; } });
    const v2 = defineWorkflow({ name: 'evolving', async handler(ctx) { await ctx.step('validate', async () => 0); await ctx.step('reserve', async () => 1); await ctx.waitForSignal('go'); return 'v2'; } });
    const e1 = makeEngine(db, [v1]); const w1 = startWorker(e1);
    const run = e1.start('evolving', {});
    await waitForStatus(e1, run.id, 'waiting');
    await w1.stop(); e1.close();
    const e2 = makeEngine(db, [v2]); const w2 = startWorker(e2);
    assert.equal(e2.describe(run.id).codeChanged, true);
    e2.signal(run.id, 'go', {});
    const done = await waitTerminal(e2, run.id);
    await w2.stop(); e2.close();
    assert.equal(done.status, 'failed');
    assert.equal(done.error.name, 'NonDeterminismError');
    assert.match(done.error.message, /seq 1: history recorded step "reserve" but workflow code now calls step "validate"/);
  });
  test('ctx.patched() lets new code take a new branch only for new runs', async () => {
    const db = newDb();
    const v1 = defineWorkflow({ name: 'patchy', async handler(ctx) { await ctx.step('a', async () => 1); await ctx.waitForSignal('go'); return 'old'; } });
    const v2 = defineWorkflow({ name: 'patchy', async handler(ctx) { const p = ctx.patched('add-audit'); if (p) await ctx.step('audit', async () => 0); await ctx.step('a', async () => 1); await ctx.waitForSignal('go'); return p ? 'new' : 'old-path'; } });
    const e1 = makeEngine(db, [v1]); const w1 = startWorker(e1);
    const oldRun = e1.start('patchy', {});
    await waitForStatus(e1, oldRun.id, 'waiting');
    await w1.stop(); e1.close();
    const e2 = makeEngine(db, [v2]); const w2 = startWorker(e2);
    const newRun = e2.start('patchy', {});
    await waitForStatus(e2, newRun.id, 'waiting');
    e2.signal(oldRun.id, 'go', {}); e2.signal(newRun.id, 'go', {});
    const d1 = await waitTerminal(e2, oldRun.id); const d2 = await waitTerminal(e2, newRun.id);
    await w2.stop(); e2.close();
    assert.equal(d1.status, 'completed'); assert.equal(d1.result, 'old-path');
    assert.equal(d2.status, 'completed'); assert.equal(d2.result, 'new');
  });
});

describe('task routing', () => {
  test('a worker only claims runs of workflows it has registered', async () => {
    const db = newDb();
    const x = defineWorkflow({ name: 'only-x', async handler(ctx) { return ctx.step('a', async () => 'x'); } });
    const y = defineWorkflow({ name: 'only-y', async handler(ctx) { return ctx.step('a', async () => 'y'); } });
    const client = makeEngine(db, [x, y]);
    const wEngine = makeEngine(db, [x]); const worker = startWorker(wEngine);
    const rx = client.start('only-x', {}); const ry = client.start('only-y', {});
    await waitTerminal(client, rx.id);
    await sleep(200);
    assert.equal(client.store.getRun(ry.id).status, 'pending', 'run of an unknown workflow is left for another worker');
    await worker.stop(); wEngine.close();
    const yEngine = makeEngine(db, [y]); const w2 = startWorker(yEngine);
    const dy = await waitTerminal(client, ry.id);
    await w2.stop(); yEngine.close(); client.close();
    assert.equal(dy.result, 'y');
  });
});

describe('cancel and retry', () => {
  test('cancelling a waiting run throws CancelledError into the workflow (compensation runs)', async () => {
    const engine = makeEngine(newDb(), demoWorkflows); const worker = startWorker(engine);
    const run = engine.start('order-saga', { orderId: 'SO-11', sku: 'X', qty: 1, amount: 1, simulate: { chargeFailures: 3, delayMs: 5 } });
    await waitFor(() => engine.store.getRun(run.id).waiting_on?.some(w => w.kind === 'retry'), { msg: 'retry wait' });
    engine.cancel(run.id);
    const done = await waitTerminal(engine, run.id);
    const types = eventTypes(engine, run.id);
    const retry = engine.retry(run.id);
    await worker.stop(); engine.close();
    assert.equal(done.status, 'cancelled');
    assert.ok(types.includes('CancelRequested'));
    assert.ok(types.includes('StepCompleted:releaseStock'), 'compensation executed on cancel');
    assert.equal(retry.retry_of, run.id);
  });
});
