// Tiny OTLP/HTTP collector + trace viewer server.
//   POST /v1/traces   OTLP/HTTP JSON (Content-Type: application/json, optional Content-Encoding: gzip)
//   POST /v1/logs     OTLP/HTTP JSON logs (trace_id / span_id correlated)
//   GET  /api/...     JSON query API used by the viewer (see README.html, developer guide)
//   GET  /            viewer UI (public/)
// Run: node src/collector/server.mjs [--port 4318] [--host 127.0.0.1] [--data-dir DIR] [--jsonl] [--debug]
import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { gunzip, inflate } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { decodeTraces, decodeLogs } from './otlp.mjs';
import { openStore } from './store.mjs';

const require = createRequire(import.meta.url);
const { parseArgs, resolveConfig, intArg } = require('../common/config.cjs');
const { createLogger } = require('../common/logger.cjs');

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const MAX_BODY = 32 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { rej(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'content-length': buf.length, ...headers,
  });
  res.end(buf);
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type, content-encoding' };

/**
 * Start the collector. Returns { server, port, url, store, close() }.
 * @param {{port?:number, host?:string, dataDir:string, logDir:string, debug?:boolean, jsonl?:boolean, dbFile?:string}} opts
 */
export async function startCollector(opts) {
  const { host = '127.0.0.1', dataDir, logDir, debug = false, jsonl = false } = opts;
  const log = createLogger({ service: 'collector', logDir, debug });
  const dbFile = opts.dbFile || join(dataDir, 'traces.db');
  const store = openStore(dbFile);
  const counters = { spans: 0, logs: 0, requests: 0, rejected: 0 };
  if (jsonl) await mkdir(dataDir, { recursive: true });

  async function decodeOtlpBody(req) {
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype === 'application/x-protobuf' || ctype === 'application/protobuf') {
      throw Object.assign(new Error('protobuf encoding is not supported by this collector; configure the exporter for OTLP/HTTP JSON (@opentelemetry/exporter-trace-otlp-http)'), { status: 415 });
    }
    let raw = await readBody(req);
    const enc = String(req.headers['content-encoding'] || '').toLowerCase();
    if (enc === 'gzip') raw = await gunzipAsync(raw);
    else if (enc === 'deflate') raw = await inflateAsync(raw);
    try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    counters.requests++;
    if (req.method === 'OPTIONS') return send(res, 204, '', CORS);

    if (req.method === 'POST' && p === '/v1/traces') {
      const payload = await decodeOtlpBody(req);
      const rows = decodeTraces(payload);
      store.insertSpans(rows);
      counters.spans += rows.length;
      if (jsonl && rows.length) await appendFile(join(dataDir, 'spans.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      log.debug('spans received', { count: rows.length, services: [...new Set(rows.map((r) => r.service))].join(',') });
      return send(res, 200, { partialSuccess: {} }, CORS);
    }
    if (req.method === 'POST' && p === '/v1/logs') {
      const rows = decodeLogs(await decodeOtlpBody(req));
      store.insertLogs(rows);
      counters.logs += rows.length;
      log.debug('logs received', { count: rows.length });
      return send(res, 200, { partialSuccess: {} }, CORS);
    }
    if (req.method === 'POST' && p === '/v1/metrics') return send(res, 200, { partialSuccess: {} }, CORS); // accepted and ignored

    if (req.method === 'GET' && p === '/api/traces') {
      const q = url.searchParams;
      return send(res, 200, store.listTraces({
        service: q.get('service') || '', status: q.get('status') || '', q: q.get('q') || '',
        minDurationMs: Number(q.get('minDurationMs') || 0), sinceMinutes: Number(q.get('sinceMinutes') || 0), limit: Number(q.get('limit') || 100),
      }));
    }
    let m = /^\/api\/traces\/([0-9a-f]{32})$/i.exec(p);
    if (req.method === 'GET' && m) {
      const t = store.getTrace(m[1].toLowerCase());
      if (!t.spans.length) return send(res, 404, { error: 'trace not found' });
      return send(res, 200, t);
    }
    if (req.method === 'GET' && p === '/api/logs') {
      return send(res, 200, store.getLogs({ traceId: url.searchParams.get('traceId') || '', spanId: url.searchParams.get('spanId') || '', limit: Number(url.searchParams.get('limit') || 500) }));
    }
    if (req.method === 'GET' && p === '/api/services') return send(res, 200, store.services());
    if (req.method === 'GET' && p === '/api/dependencies') {
      return send(res, 200, store.dependencies({ sinceMinutes: Number(url.searchParams.get('sinceMinutes') || 0), traceId: url.searchParams.get('traceId') || '' }));
    }
    if (req.method === 'GET' && p === '/api/stats') return send(res, 200, { ...store.stats(), received: counters, dbFile });
    if (req.method === 'POST' && p === '/api/clear') { store.clear(); log.info('store cleared'); return send(res, 200, { ok: true }); }
    if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true });

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(p, res);
    return send(res, 404, { error: 'not found' });
  }

  async function serveStatic(p, res) {
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const file = resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(resolve(PUBLIC_DIR) + sep)) return send(res, 403, 'forbidden');
    try {
      const data = await readFile(file);
      return send(res, 200, data, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    } catch {
      return send(res, 404, 'not found');
    }
  }

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    handle(req, res).catch((err) => {
      const status = err.status || 500;
      counters.rejected++;
      log[status >= 500 ? 'error' : 'warn']('request failed', { method: req.method, path: req.url, status, error: err.message });
      if (!res.headersSent) send(res, status, { error: err.message }, CORS);
    }).finally(() => {
      if (debug) log.debug('http', { method: req.method, path: req.url, status: res.statusCode, ms: Date.now() - t0 });
    });
  });

  await new Promise((r, j) => { server.once('error', j); server.listen(opts.port ?? 4318, host, r); });
  const port = server.address().port;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  log.info(`collector + viewer listening on ${url}`, { port, dbFile, logDir });
  return {
    server, port, url, store, log,
    async close() {
      await new Promise((r) => server.close(r));
      store.close();
      await log.close();
    },
  };
}

// CLI entry
// Run as CLI only when this file is the entry point (case-insensitive on Windows drive letters).
const norm = (f) => (process.platform === 'win32' ? resolve(f).toLowerCase() : resolve(f));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  const args = parseArgs();
  const cfg = resolveConfig(args);
  const c = await startCollector({ port: intArg(args.port, 4318), host: String(args.host || '127.0.0.1'), dataDir: cfg.dataDir, logDir: cfg.logDir, debug: cfg.debug, jsonl: Boolean(args.jsonl) });
  process.stdout.write(`OTV_READY ${JSON.stringify({ service: 'collector', port: c.port })}\n`);
  const stop = async () => { await c.close(); process.exit(0); };
  process.on('SIGINT', () => { if (!process.connected) stop(); }); // under start-all.mjs the parent orchestrates shutdown
  process.on('SIGTERM', stop);
  process.on('message', (m) => { if (m === 'shutdown') stop(); });
}
