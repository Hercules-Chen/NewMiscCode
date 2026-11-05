// Span / log storage on SQLite (built-in node:sqlite, no native addon needed).
// node:sqlite is synchronous; every call here is a short indexed query, and the HTTP layer stays async.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spans (
  trace_id TEXT NOT NULL, span_id TEXT NOT NULL, parent_span_id TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL, name TEXT NOT NULL, kind INTEGER NOT NULL DEFAULT 0,
  start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, duration_us INTEGER NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 0, status_message TEXT NOT NULL DEFAULT '',
  attributes TEXT NOT NULL DEFAULT '{}', events TEXT NOT NULL DEFAULT '[]', links TEXT NOT NULL DEFAULT '[]',
  resource TEXT NOT NULL DEFAULT '{}', scope TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX IF NOT EXISTS idx_spans_start ON spans(start_us);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, time_us INTEGER NOT NULL,
  trace_id TEXT NOT NULL DEFAULT '', span_id TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL, severity TEXT NOT NULL, severity_number INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(trace_id, span_id);
`;

const parseSpan = (r) => ({
  ...r,
  attributes: JSON.parse(r.attributes), events: JSON.parse(r.events), links: JSON.parse(r.links), resource: JSON.parse(r.resource),
});
const parseLog = (r) => ({ ...r, attributes: JSON.parse(r.attributes) });

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const insSpan = db.prepare(`INSERT OR REPLACE INTO spans
    (trace_id, span_id, parent_span_id, service, name, kind, start_us, end_us, duration_us, status_code, status_message, attributes, events, links, resource, scope, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insLog = db.prepare(`INSERT INTO logs (time_us, trace_id, span_id, service, severity, severity_number, body, attributes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  function tx(fn) {
    db.exec('BEGIN');
    try { fn(); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  return {
    file,
    insertSpans(rows) {
      const now = Date.now();
      tx(() => {
        for (const s of rows) {
          insSpan.run(s.trace_id, s.span_id, s.parent_span_id, s.service, s.name, s.kind, s.start_us, s.end_us, s.duration_us,
            s.status_code, s.status_message, JSON.stringify(s.attributes), JSON.stringify(s.events), JSON.stringify(s.links),
            JSON.stringify(s.resource), s.scope, now);
        }
      });
      return rows.length;
    },
    insertLogs(rows) {
      tx(() => {
        for (const l of rows) {
          insLog.run(l.time_us, l.trace_id, l.span_id, l.service, l.severity, l.severity_number, l.body, JSON.stringify(l.attributes));
        }
      });
      return rows.length;
    },
    /** Trace summaries with filters: service, status (ok|error), minDurationMs, sinceMinutes, q (root name contains), limit. */
    listTraces({ service = '', status = '', minDurationMs = 0, sinceMinutes = 0, q = '', limit = 100 } = {}) {
      const having = [];
      const params = [];
      const where = [];
      if (sinceMinutes > 0) { where.push('start_us >= ?'); params.push((Date.now() - sinceMinutes * 60000) * 1000); }
      if (service) { having.push('SUM(service = ?) > 0'); params.push(service); }
      if (status === 'error') having.push('SUM(status_code = 2) > 0');
      if (status === 'ok') having.push('SUM(status_code = 2) = 0');
      if (minDurationMs > 0) { having.push('(MAX(end_us) - MIN(start_us)) >= ?'); params.push(Math.round(minDurationMs * 1000)); }
      const sql = `
        SELECT trace_id, MIN(start_us) AS start_us, MAX(end_us) AS end_us, MAX(end_us) - MIN(start_us) AS duration_us,
               COUNT(*) AS span_count, SUM(status_code = 2) AS error_count, GROUP_CONCAT(DISTINCT service) AS services
        FROM spans ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY trace_id ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
        ORDER BY start_us DESC LIMIT ?`;
      params.push(Math.min(Math.max(limit, 1), 1000));
      const rows = db.prepare(sql).all(...params);
      const rootStmt = db.prepare(`SELECT service, name FROM spans WHERE trace_id = ?
        ORDER BY (parent_span_id = '' OR parent_span_id NOT IN (SELECT span_id FROM spans s2 WHERE s2.trace_id = spans.trace_id)) DESC, start_us ASC LIMIT 1`);
      let out = rows.map((r) => {
        const root = rootStmt.get(r.trace_id) || {};
        return { ...r, services: String(r.services || '').split(',').filter(Boolean).sort(), root_service: root.service || '', root_name: root.name || '' };
      });
      if (q) { const needle = q.toLowerCase(); out = out.filter((t) => t.root_name.toLowerCase().includes(needle) || t.trace_id.startsWith(needle)); }
      return out;
    },
    getTrace(traceId) {
      const spans = db.prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_us ASC').all(traceId).map(parseSpan);
      const logs = db.prepare('SELECT * FROM logs WHERE trace_id = ? ORDER BY time_us ASC, id ASC').all(traceId).map(parseLog);
      return { trace_id: traceId, spans, logs };
    },
    getLogs({ traceId = '', spanId = '', limit = 500 } = {}) {
      const where = [];
      const params = [];
      if (traceId) { where.push('trace_id = ?'); params.push(traceId); }
      if (spanId) { where.push('span_id = ?'); params.push(spanId); }
      params.push(limit);
      return db.prepare(`SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY time_us DESC, id DESC LIMIT ?`).all(...params).map(parseLog);
    },
    services() {
      return db.prepare('SELECT service, COUNT(*) AS span_count, SUM(status_code = 2) AS error_count FROM spans GROUP BY service ORDER BY service').all();
    },
    /** Service dependency edges: parent span service -> child span service when they differ. */
    dependencies({ sinceMinutes = 0, traceId = '' } = {}) {
      const where = ['c.service <> p.service'];
      const params = [];
      if (sinceMinutes > 0) { where.push('c.start_us >= ?'); params.push((Date.now() - sinceMinutes * 60000) * 1000); }
      if (traceId) { where.push('c.trace_id = ?'); params.push(traceId); }
      return db.prepare(`SELECT p.service AS source, c.service AS target, COUNT(*) AS calls, SUM(c.status_code = 2) AS errors
        FROM spans c JOIN spans p ON p.trace_id = c.trace_id AND p.span_id = c.parent_span_id
        WHERE ${where.join(' AND ')} GROUP BY p.service, c.service ORDER BY calls DESC`).all(...params);
    },
    stats() {
      return {
        spans: db.prepare('SELECT COUNT(*) AS n FROM spans').get().n,
        traces: db.prepare('SELECT COUNT(DISTINCT trace_id) AS n FROM spans').get().n,
        logs: db.prepare('SELECT COUNT(*) AS n FROM logs').get().n,
      };
    },
    clear() { db.exec('DELETE FROM spans; DELETE FROM logs;'); },
    close() { db.close(); },
  };
}
