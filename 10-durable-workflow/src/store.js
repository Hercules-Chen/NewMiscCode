// SQLite persistence (node:sqlite, synchronous API; WAL + busy_timeout so several
// processes - dashboard server, workers, CLI - can share one database file).
const origEmitWarning = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w && w.message || w).includes('SQLite is an experimental feature')) return;
  return origEmitWarning.call(process, w, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = origEmitWarning;
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  version TEXT,
  code_hash TEXT,
  status TEXT NOT NULL,              -- pending | running | waiting | completed | failed | cancelled
  input TEXT,
  result TEXT,
  error TEXT,
  waiting_on TEXT,                   -- JSON array describing what a waiting run is blocked on
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  retry_of TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_runs_status ON workflow_runs(status, created_at);
CREATE TABLE IF NOT EXISTS history_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER,                        -- command sequence number (NULL for run-level events)
  type TEXT NOT NULL,
  name TEXT,
  data TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_run ON history_events(run_id, id);
CREATE TABLE IF NOT EXISTS timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- sleep | signal-timeout | retry
  fire_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | fired | cancelled
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_timers_run ON timers(run_id, status);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | consumed
  consumed_seq INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_signals_run ON signals(run_id, status, name);
CREATE TABLE IF NOT EXISTS tasks (
  run_id TEXT PRIMARY KEY,            -- at most one workflow task per run
  visible_at INTEGER NOT NULL,
  gen INTEGER NOT NULL DEFAULT 1,     -- bumped on every enqueue (detects new work during processing)
  lease_owner TEXT,
  lease_expires_at INTEGER,
  prev_owner TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks_visible ON tasks(visible_at);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  pid INTEGER,
  host TEXT,
  workflows TEXT,
  started_at INTEGER,
  heartbeat_at INTEGER,
  stopped_at INTEGER
);
`;

export class LeaseLostError extends Error {
  constructor(runId) { super(`lease lost for run ${runId}`); this.name = 'LeaseLostError'; }
}

const j = v => (v === undefined ? null : JSON.stringify(v));
const pj = s => (s == null ? undefined : JSON.parse(s));

export class Store {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
    this.db.exec(SCHEMA);
    this.db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('schema_version', String(SCHEMA_VERSION));
    this._stmts = new Map();
  }
  close() { try { this.db.close(); } catch { /* already closed */ } }
  st(sql) {
    let s = this._stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }

  // ---- runs ----
  insertRun(r) {
    const now = Date.now();
    this.st(`INSERT INTO workflow_runs(id,workflow,version,code_hash,status,input,retry_of,created_at,updated_at)
             VALUES(?,?,?,?,'pending',?,?,?,?)`).run(r.id, r.workflow, r.version ?? null, r.codeHash ?? null, j(r.input), r.retryOf ?? null, now, now);
  }
  getRun(id) { return this.mapRun(this.st('SELECT * FROM workflow_runs WHERE id=?').get(id)); }
  mapRun(row) {
    if (!row) return null;
    return { ...row, input: pj(row.input), result: pj(row.result), error: pj(row.error), waiting_on: pj(row.waiting_on), cancel_requested: !!row.cancel_requested };
  }
  listRuns({ status, workflow, limit = 100, offset = 0 } = {}) {
    const where = []; const args = [];
    if (status) { where.push('status=?'); args.push(status); }
    if (workflow) { where.push('workflow=?'); args.push(workflow); }
    const sql = `SELECT * FROM workflow_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...args, Number(limit), Number(offset)).map(r => this.mapRun(r));
  }
  countByStatus() {
    const out = {};
    for (const r of this.st('SELECT status, COUNT(*) n FROM workflow_runs GROUP BY status').all()) out[r.status] = r.n;
    return out;
  }
  updateRun(id, fields) {
    const keys = Object.keys(fields);
    const enc = { result: j, error: j, waiting_on: j };
    const sets = keys.map(k => `${k}=?`).join(',');
    const vals = keys.map(k => (enc[k] ? enc[k](fields[k]) : fields[k]));
    this.db.prepare(`UPDATE workflow_runs SET ${sets}, updated_at=? WHERE id=?`).run(...vals, Date.now(), id);
  }

  // ---- history ----
  appendEvent(runId, ev, leaseOwner) {
    return this.tx(() => {
      if (leaseOwner) {
        const t = this.st('SELECT lease_owner FROM tasks WHERE run_id=?').get(runId);
        if (!t || t.lease_owner !== leaseOwner) throw new LeaseLostError(runId);
      }
      const ts = Date.now();
      const r = this.st('INSERT INTO history_events(run_id,seq,type,name,data,ts) VALUES(?,?,?,?,?,?)')
        .run(runId, ev.seq ?? null, ev.type, ev.name ?? null, j(ev.data ?? {}), ts);
      return { id: Number(r.lastInsertRowid), run_id: runId, seq: ev.seq ?? null, type: ev.type, name: ev.name ?? null, data: ev.data ?? {}, ts };
    });
  }
  history(runId) {
    return this.st('SELECT * FROM history_events WHERE run_id=? ORDER BY id').all(runId).map(e => ({ ...e, data: pj(e.data) || {} }));
  }

  // ---- timers ----
  insertTimer(runId, seq, kind, fireAt) {
    this.st('INSERT INTO timers(run_id,seq,kind,fire_at,status,created_at) VALUES(?,?,?,?,\'pending\',?)').run(runId, seq, kind, fireAt, Date.now());
  }
  setTimerStatus(runId, seq, kind, status) {
    this.st('UPDATE timers SET status=? WHERE run_id=? AND seq=? AND kind=? AND status=\'pending\'').run(status, runId, seq, kind);
  }
  cancelTimers(runId) { this.st('UPDATE timers SET status=\'cancelled\' WHERE run_id=? AND status=\'pending\'').run(runId); }
  timers(runId) { return this.st('SELECT * FROM timers WHERE run_id=? ORDER BY id').all(runId); }
  pendingTimers(limit = 50) { return this.st('SELECT * FROM timers WHERE status=\'pending\' ORDER BY fire_at LIMIT ?').all(limit); }

  // ---- signals ----
  insertSignal(runId, name, payload) {
    const r = this.st('INSERT INTO signals(run_id,name,payload,status,created_at) VALUES(?,?,?,\'pending\',?)').run(runId, name, j(payload), Date.now());
    return Number(r.lastInsertRowid);
  }
  nextPendingSignal(runId, name) {
    const s = this.st('SELECT * FROM signals WHERE run_id=? AND name=? AND status=\'pending\' ORDER BY id LIMIT 1').get(runId, name);
    return s ? { ...s, payload: pj(s.payload) } : null;
  }
  consumeSignal(id, seq) { this.st('UPDATE signals SET status=\'consumed\', consumed_seq=? WHERE id=?').run(seq, id); }
  signals(runId) { return this.st('SELECT * FROM signals WHERE run_id=? ORDER BY id').all(runId).map(s => ({ ...s, payload: pj(s.payload) })); }

  // ---- task queue with leases ----
  enqueue(runId, at = Date.now()) {
    this.st(`INSERT INTO tasks(run_id,visible_at,gen,created_at) VALUES(?,?,1,?)
             ON CONFLICT(run_id) DO UPDATE SET visible_at=MIN(visible_at, excluded.visible_at), gen=gen+1`).run(runId, at, Date.now());
  }
  /** Atomically lease the next visible task whose workflow is in `workflows` (names this worker can run). */
  claimTask(owner, leaseMs, workflows) {
    const now = Date.now();
    return this.st(`UPDATE tasks SET prev_owner=lease_owner, lease_owner=?, lease_expires_at=?, attempts=attempts+1
      WHERE run_id = (SELECT t.run_id FROM tasks t JOIN workflow_runs r ON r.id = t.run_id
                      WHERE t.visible_at<=? AND (t.lease_owner IS NULL OR t.lease_expires_at<?)
                        AND r.workflow IN (SELECT value FROM json_each(?))
                      ORDER BY t.visible_at LIMIT 1)
      RETURNING *`).get(owner, now + leaseMs, now, now, JSON.stringify(workflows)) || null;
  }
  extendLease(runId, owner, leaseMs) {
    const r = this.st('UPDATE tasks SET lease_expires_at=? WHERE run_id=? AND lease_owner=?').run(Date.now() + leaseMs, runId, owner);
    return r.changes > 0;
  }
  finishTask(runId, owner, gen, { done, wakeAt }) {
    return this.tx(() => {
      const t = this.st('SELECT * FROM tasks WHERE run_id=?').get(runId);
      if (!t || t.lease_owner !== owner) return 'lost';
      if (t.gen !== gen) { // new work (signal/cancel) arrived while we were executing: run again
        this.st('UPDATE tasks SET lease_owner=NULL, lease_expires_at=NULL, prev_owner=NULL WHERE run_id=?').run(runId);
        return 'requeued';
      }
      if (done || wakeAt == null) { this.st('DELETE FROM tasks WHERE run_id=?').run(runId); return 'deleted'; }
      this.st('UPDATE tasks SET visible_at=?, lease_owner=NULL, lease_expires_at=NULL, prev_owner=NULL WHERE run_id=?').run(wakeAt, runId);
      return 'scheduled';
    });
  }
  tasks() { return this.st('SELECT * FROM tasks ORDER BY visible_at').all(); }
  task(runId) { return this.st('SELECT * FROM tasks WHERE run_id=?').get(runId) || null; }

  // ---- workers ----
  upsertWorker(w) {
    this.st(`INSERT INTO workers(id,pid,host,workflows,started_at,heartbeat_at) VALUES(?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at, stopped_at=NULL`)
      .run(w.id, w.pid, w.host, j(w.workflows), w.startedAt, Date.now());
  }
  workerHeartbeat(id) { this.st('UPDATE workers SET heartbeat_at=? WHERE id=?').run(Date.now(), id); }
  workerStopped(id) { this.st('UPDATE workers SET stopped_at=? WHERE id=?').run(Date.now(), id); }
  workers(limit = 20) { return this.st('SELECT * FROM workers ORDER BY heartbeat_at DESC LIMIT ?').all(limit).map(w => ({ ...w, workflows: pj(w.workflows) })); }
}
