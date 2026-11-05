// Worker loop: claims workflow tasks from the SQLite task queue using leases,
// heartbeats the lease while executing, and reschedules / deletes the task afterwards.
// If a worker process dies, its lease expires and another worker (or the restarted one)
// claims the task and resumes the run by replaying its history.
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export class Worker {
  constructor(engine, { concurrency, pollMs, leaseMs, id, logger } = {}) {
    this.engine = engine;
    this.store = engine.store;
    const cfg = engine.config;
    this.concurrency = concurrency || cfg.concurrency || 4;
    this.pollMs = pollMs || cfg.pollMs || 250;
    this.leaseMs = leaseMs || cfg.leaseMs || 15000;
    this.id = id || `worker-${hostname()}-${process.pid}-${randomUUID().slice(0, 4)}`;
    this.log = (logger || engine.log).child('worker');
    this.active = new Map();
    this.running = false;
    this.stats = { processed: 0, errors: 0, recovered: 0 };
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.store.upsertWorker({ id: this.id, pid: process.pid, host: hostname(), workflows: [...this.engine.registry.keys()], startedAt: Date.now() });
    this.heartbeatTimer = setInterval(() => { try { this.store.workerHeartbeat(this.id); } catch { /* db busy */ } }, Math.max(500, this.leaseMs / 3));
    this.heartbeatTimer.unref?.();
    this.log.info('worker started', { workerId: this.id, concurrency: this.concurrency, leaseMs: this.leaseMs, workflows: [...this.engine.registry.keys()] });
    this.loopPromise = this.loop();
    return this;
  }

  async loop() {
    while (this.running) {
      let claimed = false;
      if (this.active.size < this.concurrency) {
        let task = null;
        try { task = this.store.claimTask(this.id, this.leaseMs, [...this.engine.registry.keys()]); } catch (e) { this.log.warn('claim failed', { err: e.message }); }
        if (task) {
          claimed = true;
          if (task.prev_owner && task.prev_owner !== this.id) {
            this.stats.recovered++;
            this.log.warn('recovered task from expired lease', { runId: task.run_id, previousOwner: task.prev_owner, workerId: this.id });
          }
          const p = this.process(task).finally(() => this.active.delete(task.run_id));
          this.active.set(task.run_id, p);
        }
      }
      if (!claimed) await new Promise(r => { this.wake = r; setTimeout(r, this.pollMs); });
    }
  }

  /** Nudge the loop (e.g. right after starting a run in the same process). */
  poke() { if (this.wake) this.wake(); }

  async process(task) {
    const runId = task.run_id;
    let leaseLostCb = null;
    const hb = setInterval(() => {
      let ok = false;
      try { ok = this.store.extendLease(runId, this.id, this.leaseMs); } catch { ok = true; /* busy: try again next tick */ }
      if (!ok && leaseLostCb) leaseLostCb();
    }, Math.max(200, Math.floor(this.leaseMs / 3)));
    try {
      const res = await this.engine.executeRunTask(runId, this.id, { onLeaseLost: cb => { leaseLostCb = cb; } });
      if (res.lost) return;
      const r = this.store.finishTask(runId, this.id, task.gen, res);
      this.stats.processed++;
      this.log.debug('task finished', { runId, outcome: r, wakeAt: res.wakeAt ?? null, done: res.done });
    } catch (e) {
      this.stats.errors++;
      this.log.error('task execution error', { runId, err: e });
      // back off: make the task visible again a bit later
      try { this.store.finishTask(runId, this.id, task.gen, { done: false, wakeAt: Date.now() + 2000 }); } catch { /* ignore */ }
    } finally {
      clearInterval(hb);
    }
  }

  async stop({ timeoutMs = 10000 } = {}) {
    if (!this.running) return;
    this.running = false;
    this.poke();
    clearInterval(this.heartbeatTimer);
    await this.loopPromise;
    let to;
    await Promise.race([Promise.allSettled([...this.active.values()]), new Promise(r => { to = setTimeout(r, timeoutMs); })]);
    clearTimeout(to);
    try { this.store.workerStopped(this.id); } catch { /* ignore */ }
    this.log.info('worker stopped', { workerId: this.id, ...this.stats });
  }
}
