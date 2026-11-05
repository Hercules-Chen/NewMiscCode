import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine, TERMINAL } from '../src/engine.js';
import { Worker } from '../src/worker.js';
import { Logger } from '../src/logger.js';

export function tempDir(prefix = 'wf-test-') {
  const dir = mkdtempSync(join(process.env.WF_TEST_TMP || tmpdir(), prefix));
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ } } };
}

export function makeEngine(dbFile, workflows, { leaseMs = 2000, pollMs = 20, debug = false } = {}) {
  const logger = new Logger({ toFile: false, toConsole: !!process.env.WF_TEST_LOG, debug });
  return new Engine({ config: { dbFile, leaseMs, pollMs, concurrency: 4 }, logger, workflows });
}

export function startWorker(engine, opts = {}) {
  return new Worker(engine, { pollMs: 20, leaseMs: engine.config.leaseMs, ...opts }).start();
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 10000, interval = 20, msg = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${msg}`);
    await sleep(interval);
  }
}

export function waitForStatus(engine, runId, statuses, timeout = 10000) {
  const want = new Set([].concat(statuses));
  return waitFor(() => { const r = engine.store.getRun(runId); return r && want.has(r.status) ? r : null; }, { timeout, msg: `${runId} -> ${[...want]}` });
}

export function waitTerminal(engine, runId, timeout = 10000) { return waitForStatus(engine, runId, [...TERMINAL], timeout); }

export function eventTypes(engine, runId) {
  return engine.store.history(runId).map(e => `${e.type}${e.name ? ':' + e.name : ''}`);
}
