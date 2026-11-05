'use strict';
// Shared bootstrap for the demo services: tracing -> logger -> tiny router -> HTTP server.
// Usage (from a service file):  require('./base.cjs').runService('orders', ({ route, tracer, log, cfg }) => { ... });
const { startTracing } = require('./tracing.cjs');
const { parseArgs, resolveConfig, intArg } = require('../common/config.cjs');
const { createLogger } = require('../common/logger.cjs');

function runService(serviceName, setup) {
  const args = parseArgs();
  const cfg = resolveConfig(args);
  const collectorUrl = String(args.collector || process.env.OTV_COLLECTOR_URL || 'http://127.0.0.1:4318').replace(/\/$/, '');
  const sdk = startTracing({ serviceName, collectorUrl, debug: cfg.debug });

  // node:http must be loaded AFTER the SDK started so the http instrumentation can patch it.
  const http = require('node:http');
  const api = require('@opentelemetry/api');
  const log = createLogger({ service: serviceName, logDir: cfg.logDir, debug: cfg.debug, collectorUrl });
  const tracer = api.trace.getTracer(`demo-${serviceName}`, '0.1.0');
  const routes = [];

  function route(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, pattern, re, keys, handler });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }

  const ctxExtras = { tracer, log, cfg, args, api, sendJson };
  setup({ route, ...ctxExtras });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, service: serviceName });
    const serverSpan = api.trace.getActiveSpan();
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (serverSpan) {
        serverSpan.updateName(`${req.method} ${r.pattern}`);
        serverSpan.setAttribute('http.route', r.pattern);
        // Expose the trace id so callers (and the tests) can jump straight to the trace in the viewer.
        res.setHeader('x-trace-id', serverSpan.spanContext().traceId);
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const raw = req.method === 'POST' ? await readBody(req) : '';
        let body = {};
        if (raw) { try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); } }
        log.debug('request', { method: req.method, path: url.pathname });
        await r.handler({ req, res, params, query: url.searchParams, body, json: (s, o) => sendJson(res, s, o) });
      } catch (err) {
        if (serverSpan) {
          serverSpan.recordException(err);
          serverSpan.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
        }
        log.error('unhandled error', { error: err.message });
        if (!res.headersSent) sendJson(res, 500, { error: err.message });
      }
      return;
    }
    sendJson(res, 404, { error: 'not found', path: url.pathname });
  });

  const host = String(args.host || process.env.OTV_HOST || '127.0.0.1');
  server.listen(intArg(args.port, 0), host, () => {
    const port = server.address().port;
    log.info(`${serviceName} listening on http://${host}:${port}`, { port, collector: collectorUrl });
    // Machine-readable readiness line consumed by start-all.mjs and the tests.
    process.stdout.write(`OTV_READY ${JSON.stringify({ service: serviceName, port })}\n`);
  });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    log.info(`${serviceName} shutting down`, { signal });
    server.close();
    try { await sdk.shutdown(); } catch (err) { process.stderr.write(`sdk shutdown: ${err.message}\n`); }
    await log.close();
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // When started by start-all.mjs (IPC channel present), Ctrl+C is handled by the parent, which stops
  // the services first and the collector last so that the final spans/logs are still delivered.
  process.on('SIGINT', () => { if (!process.connected) shutdown('SIGINT'); });
  // Allow a parent process to request graceful shutdown on Windows (no POSIX signals there).
  process.on('message', (m) => { if (m === 'shutdown') shutdown('ipc'); });
  return { server, tracer, log };
}

module.exports = { runService };
