// Durable execution engine: client API (start / signal / cancel / retry / query)
// and the replay executor that runs one "workflow task" for a run.
//
// Execution model (same idea as Temporal / Azure Durable Functions):
//   * Every ctx.* call in workflow code gets a sequence number (seq) in call order.
//   * Results of steps, timers, signals and side effects are appended to history_events.
//   * When a run is woken up (timer due, signal arrived, worker restarted) the workflow
//     function is executed again FROM THE START. ctx calls whose seq already has a result
//     in history return that result immediately (replay) instead of running the activity.
//   * When code reaches a call that cannot complete yet (timer not due, no signal), the call
//     returns a promise that never resolves; once nothing is in flight the run is "suspended"
//     and the task is rescheduled for the earliest wake-up time.
//   * If the code asks for something different from what history recorded at that seq
//     (different step name / kind), a NonDeterminismError fails the run.
import { randomUUID, createHash } from 'node:crypto';
import { Store, LeaseLostError } from './store.js';
import { NonDeterminismError, StepFailedError, TimeoutError, CancelledError, serializeError, deserializeError } from './errors.js';
import { nullLogger } from './logger.js';

export const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const KIND_OF = {
  StepStarted: 'step', StepAttemptFailed: 'step', StepCompleted: 'step', StepFailed: 'step',
  TimerStarted: 'sleep', TimerFired: 'sleep',
  SignalWaitStarted: 'signal', SignalReceived: 'signal', SignalTimedOut: 'signal',
  SideEffectRecorded: 'sideEffect',
};
const NEVER = () => new Promise(() => {});

export const DEFAULT_RETRY = { maxAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2, maxIntervalMs: 60000, nonRetryableErrors: [] };

export function backoffDelay(retry, attempt) {
  const r = { ...DEFAULT_RETRY, ...retry };
  return Math.min(r.maxIntervalMs, Math.round(r.initialIntervalMs * Math.pow(r.backoffCoefficient, attempt - 1)));
}

export function defineWorkflow(def) {
  if (!def || !def.name || typeof def.handler !== 'function') throw new Error('defineWorkflow needs { name, handler }');
  return { version: '1', ...def, codeHash: createHash('sha256').update(def.handler.toString()).digest('hex').slice(0, 12) };
}

export class Engine {
  constructor({ config, logger = nullLogger, workflows = [] }) {
    this.config = config;
    this.log = logger.child ? logger.child('engine') : logger;
    this.store = new Store(config.dbFile);
    this.registry = new Map();
    for (const w of workflows) this.register(w);
  }
  register(def) { const d = def.codeHash ? def : defineWorkflow(def); this.registry.set(d.name, d); return d; }
  close() { this.store.close(); }

  // ---------------- client API ----------------
  start(workflow, input = {}, { runId, retryOf } = {}) {
    const def = this.registry.get(workflow);
    if (!def) throw Object.assign(new Error(`unknown workflow "${workflow}"`), { status: 400 });
    const id = runId || `${workflow}-${randomUUID().slice(0, 8)}`;
    if (this.store.getRun(id)) throw Object.assign(new Error(`run id "${id}" already exists`), { status: 409 });
    this.store.tx(() => {
      this.store.insertRun({ id, workflow, version: def.version, codeHash: def.codeHash, input, retryOf });
      this.store.st('INSERT INTO history_events(run_id,seq,type,name,data,ts) VALUES(?,NULL,?,?,?,?)')
        .run(id, 'WorkflowStarted', workflow, JSON.stringify({ input, version: def.version, codeHash: def.codeHash, retryOf: retryOf || undefined }), Date.now());
      this.store.enqueue(id);
    });
    this.log.info('run started', { runId: id, workflow });
    return this.store.getRun(id);
  }
  signal(runId, name, payload) {
    const run = this.mustRun(runId);
    if (TERMINAL.has(run.status)) throw Object.assign(new Error(`run ${runId} is ${run.status}; signal rejected`), { status: 409 });
    if (!name) throw Object.assign(new Error('signal name required'), { status: 400 });
    const id = this.store.tx(() => { const sid = this.store.insertSignal(runId, name, payload); this.store.enqueue(runId); return sid; });
    this.log.info('signal queued', { runId, signal: name, signalId: id });
    return { signalId: id };
  }
  cancel(runId) {
    const run = this.mustRun(runId);
    if (TERMINAL.has(run.status)) throw Object.assign(new Error(`run ${runId} is already ${run.status}`), { status: 409 });
    this.store.tx(() => { this.store.updateRun(runId, { cancel_requested: 1 }); this.store.enqueue(runId); });
    this.log.info('cancel requested', { runId });
    return { ok: true };
  }
  retry(runId) {
    const run = this.mustRun(runId);
    if (!TERMINAL.has(run.status)) throw Object.assign(new Error(`run ${runId} is still ${run.status}`), { status: 409 });
    return this.start(run.workflow, run.input, { retryOf: runId });
  }
  mustRun(runId) {
    const run = this.store.getRun(runId);
    if (!run) throw Object.assign(new Error(`run "${runId}" not found`), { status: 404 });
    return run;
  }
  describe(runId) {
    const run = this.mustRun(runId);
    const def = this.registry.get(run.workflow);
    return {
      run,
      codeChanged: def ? def.codeHash !== run.code_hash : null,
      currentCodeHash: def ? def.codeHash : null,
      events: this.store.history(runId),
      timers: this.store.timers(runId),
      signals: this.store.signals(runId),
      task: this.store.task(runId),
    };
  }

  // ---------------- executor ----------------
  /**
   * Execute (replay + advance) one workflow task. Returns { done, wakeAt }.
   * leaseOwner fences history writes: if another worker took over the lease, writes fail.
   */
  async executeRunTask(runId, leaseOwner, { onLeaseLost } = {}) {
    const store = this.store;
    const run = store.getRun(runId);
    if (!run || TERMINAL.has(run.status)) return { done: true };
    const log = this.log.child('executor');
    const def = this.registry.get(run.workflow);
    if (!def) {
      const err = { name: 'WorkflowNotRegistered', message: `workflow "${run.workflow}" is not registered in this worker` };
      store.appendEvent(runId, { type: 'WorkflowFailed', data: { error: err } }, leaseOwner);
      store.updateRun(runId, { status: 'failed', error: err, completed_at: Date.now(), waiting_on: null });
      log.error('workflow not registered', { runId, workflow: run.workflow });
      return { done: true };
    }
    const history = store.history(runId);
    const exec = new Execution({ engine: this, run, def, history, leaseOwner, log });
    if (onLeaseLost) onLeaseLost(() => exec.abort(new LeaseLostError(runId)));
    store.updateRun(runId, { status: 'running' });
    log.debug('executing workflow task', { runId, workflow: run.workflow, historyEvents: history.length, codeChanged: def.codeHash !== run.code_hash });
    const outcome = await exec.execute();
    return this.applyOutcome(run, exec, outcome, log);
  }

  applyOutcome(run, exec, outcome, log) {
    const store = this.store; const runId = run.id; const owner = exec.leaseOwner;
    const fatal = exec.fatal;
    if (fatal instanceof LeaseLostError) { log.warn('lease lost; abandoning task', { runId }); return { done: false, lost: true }; }
    const finish = (status, type, data) => {
      store.appendEvent(runId, { type, data }, owner);
      store.updateRun(runId, { status, completed_at: Date.now(), waiting_on: null, ...(data.result !== undefined ? { result: data.result } : {}), ...(data.error ? { error: data.error } : {}) });
      store.cancelTimers(runId);
      return { done: true };
    };
    try {
      if (fatal) {
        log.error('non-determinism detected', { runId, workflow: run.workflow, err: fatal.message });
        return finish('failed', 'WorkflowFailed', { error: serializeError(fatal), nonDeterminism: true });
      }
      if (outcome.kind === 'returned') {
        const unconsumed = exec.recordedSeqs.filter(s => s > exec.seq);
        if (unconsumed.length) {
          const e = new NonDeterminismError(`replay diverged: workflow code returned after seq ${exec.seq}, but history has recorded commands up to seq ${Math.max(...unconsumed)} (steps were removed or reordered in code)`, { lastSeq: exec.seq, unconsumed });
          log.error('non-determinism detected', { runId, err: e.message });
          return finish('failed', 'WorkflowFailed', { error: serializeError(e), nonDeterminism: true });
        }
        log.info('run completed', { runId, workflow: run.workflow });
        return finish('completed', 'WorkflowCompleted', { result: outcome.value === undefined ? null : outcome.value });
      }
      if (outcome.kind === 'threw') {
        const err = outcome.error;
        if (err instanceof CancelledError || (err && err.name === 'CancelledError' && exec.cancelRecorded)) {
          log.info('run cancelled', { runId });
          return finish('cancelled', 'WorkflowCancelled', { error: serializeError(err) });
        }
        log.warn('run failed', { runId, workflow: run.workflow, err: err && err.message });
        return finish('failed', 'WorkflowFailed', { error: serializeError(err) });
      }
      // suspended
      const wakes = exec.waits.map(w => w.until).filter(v => v != null);
      const wakeAt = wakes.length ? Math.min(...wakes) : null;
      store.updateRun(runId, { status: 'waiting', waiting_on: exec.waits });
      log.debug('run suspended', { runId, waits: exec.waits.length, wakeAt });
      return { done: false, wakeAt };
    } catch (e) {
      if (e instanceof LeaseLostError) { log.warn('lease lost while finishing', { runId }); return { done: false, lost: true }; }
      throw e;
    }
  }
}

class Execution {
  constructor({ engine, run, def, history, leaseOwner, log }) {
    Object.assign(this, { engine, run, def, leaseOwner, log });
    this.store = engine.store;
    this.bySeq = new Map();
    this.markers = new Set();
    for (const e of history) {
      if (e.type === 'Patched') this.markers.add(e.name);
      if (e.seq == null) continue;
      if (!this.bySeq.has(e.seq)) this.bySeq.set(e.seq, []);
      this.bySeq.get(e.seq).push(e);
    }
    this.recordedSeqs = [...this.bySeq.keys()].sort((a, b) => a - b);
    this.maxRecordedSeq = this.recordedSeqs.length ? this.recordedSeqs[this.recordedSeqs.length - 1] : 0;
    this.cancelRecorded = history.some(e => e.type === 'CancelRequested');
    this.seq = 0;
    this.inflight = 0;
    this.drainWaiters = [];
    this.waits = [];
    this.fatal = null;
    this.abortWaiters = [];
    this.ctx = new WorkflowContext(this);
  }
  append(seq, type, name, data) {
    const ev = this.store.appendEvent(this.run.id, { seq, type, name, data }, this.leaseOwner);
    if (seq != null) { if (!this.bySeq.has(seq)) this.bySeq.set(seq, []); this.bySeq.get(seq).push(ev); }
    return ev;
  }
  abort(err) { if (!this.fatal) this.fatal = err; for (const w of this.abortWaiters.splice(0)) w(); }
  fail(err) { this.abort(err); return NEVER(); }
  suspend(wait) { this.waits.push(wait); return NEVER(); }
  incInflight() { this.inflight++; }
  decInflight() { this.inflight--; if (this.inflight === 0) for (const w of this.drainWaiters.splice(0)) w(); }

  /** Events recorded for this seq; throws NonDeterminismError on kind/name mismatch. */
  check(seq, kind, name) {
    const evs = this.bySeq.get(seq) || [];
    const first = evs.find(e => KIND_OF[e.type]);
    if (first && (KIND_OF[first.type] !== kind || (name != null && first.name !== name))) {
      throw new NonDeterminismError(
        `replay diverged at seq ${seq}: history recorded ${KIND_OF[first.type]} "${first.name ?? ''}" but workflow code now calls ${kind} "${name ?? ''}"`,
        { seq, expected: { kind: KIND_OF[first.type], name: first.name }, actual: { kind, name } });
    }
    return evs;
  }
  isCancelPending() { return this.run.cancel_requested && !this.cancelRecorded; }
  takeCancel(seq) {
    this.cancelRecorded = true;
    this.append(seq, 'CancelRequested', null, {});
    throw new CancelledError();
  }

  waitIdle() {
    return new Promise(resolve => {
      const check = () => {
        if (this.fatal) return resolve();
        if (this.inflight > 0) { this.drainWaiters.push(check); return; }
        setImmediate(() => {
          if (this.inflight > 0) { this.drainWaiters.push(check); return; }
          setImmediate(() => (this.inflight > 0 ? this.drainWaiters.push(check) : resolve()));
        });
      };
      this.abortWaiters.push(resolve);
      check();
    });
  }

  async execute() {
    let p;
    try { p = Promise.resolve(this.def.handler(this.ctx, this.run.input)); } catch (e) { p = Promise.reject(e); }
    const done = p.then(value => ({ kind: 'returned', value }), error => ({ kind: 'threw', error }));
    const idle = this.waitIdle().then(() => ({ kind: 'suspended' }));
    const outcome = await Promise.race([done, idle]);
    if (outcome.kind === 'suspended') {
      // let in-flight bookkeeping settle; prefer a real completion if it raced
      const settled = await Promise.race([done, new Promise(r => setImmediate(() => r(null)))]);
      if (settled) return settled;
    }
    return outcome;
  }
}

class WorkflowContext {
  #x;
  constructor(exec) { this.#x = exec; }
  get runId() { return this.#x.run.id; }
  get workflow() { return this.#x.run.workflow; }
  get input() { return this.#x.run.input; }
  /** true while re-executing commands that already have recorded results. */
  get isReplaying() { return this.#x.seq < this.#x.maxRecordedSeq; }

  /** Replay-aware logger: messages are only written when not replaying. */
  log(msg, fields = {}) {
    const x = this.#x;
    if (this.isReplaying) return;
    x.log.child('workflow').info(msg, { runId: x.run.id, workflow: x.run.workflow, ...fields });
  }

  /**
   * Run an activity (side-effecting function) exactly once from the workflow's point of view.
   * fn receives { runId, seq, attempt, idempotencyKey, log }.
   * opts.retry = { maxAttempts, initialIntervalMs, backoffCoefficient, maxIntervalMs, nonRetryableErrors[] }
   * opts.timeoutMs = per-attempt timeout.
   */
  step(name, fn, opts = {}) {
    const x = this.#x;
    if (x.fatal) return NEVER();
    const seq = ++x.seq;
    let evs;
    try { evs = x.check(seq, 'step', name); } catch (e) { return x.fail(e); }
    if (evs.some(e => e.type === 'CancelRequested')) return Promise.reject(new CancelledError());
    const completed = evs.find(e => e.type === 'StepCompleted');
    if (completed) return Promise.resolve(completed.data.result);
    const failed = evs.find(e => e.type === 'StepFailed');
    if (failed) return Promise.reject(new StepFailedError(name, deserializeError(failed.data.error), failed.data.attempts));
    return this.#executeStep(seq, name, fn, opts, evs);
  }

  async #executeStep(seq, name, fn, opts, evs) {
    const x = this.#x;
    try {
      if (x.isCancelPending()) x.takeCancel(seq);
      const retry = { ...DEFAULT_RETRY, ...(opts.retry || {}) };
      const started = evs.filter(e => e.type === 'StepStarted').length;
      const last = evs[evs.length - 1];
      if (last && last.type === 'StepAttemptFailed' && last.data.nextAttemptAt > Date.now()) {
        return x.suspend({ kind: 'retry', seq, name, until: last.data.nextAttemptAt, attempt: started + 1 });
      }
      if (last && last.type === 'StepStarted') {
        x.log.warn('previous attempt was interrupted (worker crash?) - re-executing step', { runId: x.run.id, step: name, seq, attempt: started });
      }
      x.store.setTimerStatus(x.run.id, seq, 'retry', 'fired');
      const attempt = started + 1;
      x.append(seq, 'StepStarted', name, { attempt });
      x.incInflight();
      let result, error;
      try {
        const actx = { runId: x.run.id, seq, attempt, idempotencyKey: `${x.run.id}:${seq}`, log: (m, f) => x.log.child('activity').info(m, { runId: x.run.id, step: name, ...f }) };
        let p = Promise.resolve().then(() => fn(actx));
        if (opts.timeoutMs) {
          let t;
          p = Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`activity timed out after ${opts.timeoutMs} ms`), { name: 'ActivityTimeout' })), opts.timeoutMs); })]).finally(() => clearTimeout(t));
        }
        result = await p;
      } catch (e) { error = e || new Error('activity failed'); }
      finally { x.decInflight(); }
      if (x.fatal) return NEVER();
      if (!error) {
        x.append(seq, 'StepCompleted', name, { result: result === undefined ? null : result, attempt });
        x.log.debug('step completed', { runId: x.run.id, step: name, seq, attempt });
        return result === undefined ? null : JSON.parse(JSON.stringify(result));
      }
      const nonRetryable = error.nonRetryable || retry.nonRetryableErrors.includes(error.name);
      if (!nonRetryable && attempt < retry.maxAttempts) {
        const delay = backoffDelay(retry, attempt);
        const nextAttemptAt = Date.now() + delay;
        x.append(seq, 'StepAttemptFailed', name, { attempt, error: serializeError(error), nextAttemptAt, delayMs: delay });
        x.store.insertTimer(x.run.id, seq, 'retry', nextAttemptAt);
        x.log.warn('step attempt failed; will retry', { runId: x.run.id, step: name, attempt, delayMs: delay, err: error.message });
        return x.suspend({ kind: 'retry', seq, name, until: nextAttemptAt, attempt: attempt + 1 });
      }
      x.append(seq, 'StepFailed', name, { error: serializeError(error), attempts: attempt, nonRetryable: !!nonRetryable });
      x.log.warn('step failed permanently', { runId: x.run.id, step: name, attempts: attempt, err: error.message });
      throw new StepFailedError(name, error, attempt);
    } catch (e) {
      if (e instanceof LeaseLostError) return x.fail(e);
      throw e;
    }
  }

  /** Durable timer: survives worker restarts. */
  sleep(ms) {
    const x = this.#x;
    if (x.fatal) return NEVER();
    const seq = ++x.seq;
    let evs;
    try { evs = x.check(seq, 'sleep', null); } catch (e) { return x.fail(e); }
    if (evs.some(e => e.type === 'CancelRequested')) return Promise.reject(new CancelledError());
    if (evs.some(e => e.type === 'TimerFired')) return Promise.resolve();
    try {
      if (x.isCancelPending()) x.takeCancel(seq);
      let started = evs.find(e => e.type === 'TimerStarted');
      if (!started) {
        const fireAt = Date.now() + Math.max(0, Number(ms) || 0);
        started = x.append(seq, 'TimerStarted', null, { ms, fireAt });
        x.store.insertTimer(x.run.id, seq, 'sleep', fireAt);
      }
      if (Date.now() >= started.data.fireAt) {
        x.append(seq, 'TimerFired', null, {});
        x.store.setTimerStatus(x.run.id, seq, 'sleep', 'fired');
        return Promise.resolve();
      }
      return x.suspend({ kind: 'timer', seq, until: started.data.fireAt });
    } catch (e) {
      if (e instanceof LeaseLostError) return x.fail(e);
      return Promise.reject(e);
    }
  }

  /** Wait for an external event. Resolves with its payload; rejects with TimeoutError after opts.timeout ms. */
  waitForSignal(name, opts = {}) {
    const x = this.#x;
    if (x.fatal) return NEVER();
    const seq = ++x.seq;
    let evs;
    try { evs = x.check(seq, 'signal', name); } catch (e) { return x.fail(e); }
    if (evs.some(e => e.type === 'CancelRequested')) return Promise.reject(new CancelledError());
    const got = evs.find(e => e.type === 'SignalReceived');
    if (got) return Promise.resolve(got.data.payload);
    if (evs.some(e => e.type === 'SignalTimedOut')) return Promise.reject(new TimeoutError(`signal "${name}" not received within ${opts.timeout} ms`));
    try {
      if (x.isCancelPending()) x.takeCancel(seq);
      let started = evs.find(e => e.type === 'SignalWaitStarted');
      if (!started) {
        const timeoutAt = opts.timeout != null ? Date.now() + Number(opts.timeout) : null;
        started = x.append(seq, 'SignalWaitStarted', name, { timeoutMs: opts.timeout ?? null, timeoutAt });
        if (timeoutAt != null) x.store.insertTimer(x.run.id, seq, 'signal-timeout', timeoutAt);
      }
      const sig = x.store.nextPendingSignal(x.run.id, name);
      if (sig) {
        x.append(seq, 'SignalReceived', name, { payload: sig.payload ?? null, signalId: sig.id });
        x.store.consumeSignal(sig.id, seq);
        x.store.setTimerStatus(x.run.id, seq, 'signal-timeout', 'cancelled');
        return Promise.resolve(sig.payload ?? null);
      }
      const timeoutAt = started.data.timeoutAt;
      if (timeoutAt != null && Date.now() >= timeoutAt) {
        x.append(seq, 'SignalTimedOut', name, {});
        x.store.setTimerStatus(x.run.id, seq, 'signal-timeout', 'fired');
        return Promise.reject(new TimeoutError(`signal "${name}" not received within ${opts.timeout} ms`));
      }
      return x.suspend({ kind: 'signal', seq, name, until: timeoutAt });
    } catch (e) {
      if (e instanceof LeaseLostError) return x.fail(e);
      return Promise.reject(e);
    }
  }

  /** Record a non-deterministic value once; replays return the recorded value. Synchronous fn only. */
  sideEffect(name, fn) {
    const x = this.#x;
    if (x.fatal) return NEVER();
    const seq = ++x.seq;
    let evs;
    try { evs = x.check(seq, 'sideEffect', name); } catch (e) { return x.fail(e); }
    const rec = evs.find(e => e.type === 'SideEffectRecorded');
    if (rec) return Promise.resolve(rec.data.value);
    try {
      const value = fn();
      x.append(seq, 'SideEffectRecorded', name, { value });
      return Promise.resolve(value);
    } catch (e) {
      if (e instanceof LeaseLostError) return x.fail(e);
      return Promise.reject(e);
    }
  }
  /** Deterministic wall-clock time (ms since epoch), recorded in history. */
  now() { return this.sideEffect('now', () => Date.now()); }
  /** Deterministic Math.random() replacement. */
  random() { return this.sideEffect('random', () => Math.random()); }
  /** Deterministic UUID. */
  uuid() { return this.sideEffect('uuid', () => randomUUID()); }

  /**
   * Versioning helper (like Temporal's patched()): returns true for runs that reach this point
   * with the new code, false for runs whose history was recorded before the patch existed.
   */
  patched(id) {
    const x = this.#x;
    if (x.markers.has(id)) return true;
    if (this.isReplaying) return false;
    x.markers.add(id);
    try { x.append(null, 'Patched', id, {}); } catch (e) { if (e instanceof LeaseLostError) x.abort(e); }
    return true;
  }
}
