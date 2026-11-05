'use strict';
// Structured JSONL logger with levels, trace correlation and optional OTLP/HTTP JSON log shipping.
//  - Every record is appended to <logDir>/<service>.jsonl (async write stream).
//  - When an OpenTelemetry span is active, trace_id / span_id are added automatically.
//  - When collectorUrl is set, records are batched and POSTed to <collectorUrl>/v1/logs (OTLP JSON),
//    with tracing suppressed so that shipping logs never creates spans of its own.
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY = { debug: 5, info: 9, warn: 13, error: 17 };

let otelApi = null;
let otelCore = null;
try { otelApi = require('@opentelemetry/api'); } catch { /* optional */ }
try { otelCore = require('@opentelemetry/core'); } catch { /* optional */ }

function currentSpanIds() {
  if (!otelApi) return null;
  const span = otelApi.trace.getActiveSpan();
  if (!span) return null;
  const sc = span.spanContext();
  if (!otelApi.isSpanContextValid(sc)) return null;
  return { trace_id: sc.traceId, span_id: sc.spanId };
}

function toAnyValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: JSON.stringify(v) };
}

function createLogger({ service, logDir, debug = false, collectorUrl = null, console: toConsole = true } = {}) {
  const minLevel = debug ? LEVELS.debug : LEVELS.info;
  let stream = null;
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    stream = fs.createWriteStream(path.join(logDir, `${service}.jsonl`), { flags: 'a' });
    stream.on('error', (err) => process.stderr.write(`[logger] write error: ${err.message}\n`));
  }
  let buffer = [];
  let timer = null;
  let shipping = Promise.resolve();

  function ship() {
    if (!collectorUrl || buffer.length === 0) return shipping;
    const records = buffer;
    buffer = [];
    const body = JSON.stringify({
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeLogs: [{ scope: { name: 'otv-jsonl-logger', version: '0.1.0' }, logRecords: records }],
      }],
    });
    const send = () => fetch(`${collectorUrl}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then((r) => r.arrayBuffer())
      .catch((err) => { if (debug) process.stderr.write(`[logger] ship failed: ${err.message}\n`); });
    shipping = shipping.then(() => (otelApi && otelCore)
      ? otelApi.context.with(otelCore.suppressTracing(otelApi.context.active()), send)
      : send());
    return shipping;
  }

  function log(level, msg, fields = {}) {
    if (LEVELS[level] < minLevel) return;
    const ids = currentSpanIds();
    const now = Date.now();
    const rec = { ts: new Date(now).toISOString(), level, service, msg, ...(ids || {}), ...fields };
    if (stream) stream.write(JSON.stringify(rec) + '\n');
    if (toConsole) {
      const kv = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
      const extra = (kv ? ` ${kv}` : '') + (ids ? ` trace=${ids.trace_id.slice(0, 8)} span=${ids.span_id.slice(0, 8)}` : '');
      const line = `${rec.ts} ${level.toUpperCase().padEnd(5)} [${service}] ${msg}${extra}\n`;
      (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
    }
    if (collectorUrl) {
      const attributes = Object.entries(fields).map(([key, value]) => ({ key, value: toAnyValue(value) }));
      buffer.push({
        timeUnixNano: `${now}000000`,
        severityNumber: SEVERITY[level],
        severityText: level.toUpperCase(),
        body: { stringValue: msg },
        attributes,
        ...(ids ? { traceId: ids.trace_id, spanId: ids.span_id } : {}),
      });
      if (!timer) {
        timer = setTimeout(() => { timer = null; ship(); }, 500);
        timer.unref();
      }
    }
  }

  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    isDebug: debug,
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      await ship();
    },
    async close() {
      await this.flush();
      if (stream) await new Promise((resolve) => stream.end(resolve));
    },
  };
}

module.exports = { createLogger, LEVELS };
