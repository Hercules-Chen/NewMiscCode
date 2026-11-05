// REST API + static dashboard (node:http, no framework).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { PROJECT_DIR } from './config.js';

const PUBLIC_DIR = join(PROJECT_DIR, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

export function createApp({ engine, worker, logger }) {
  const log = logger.child('http');
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

  route('GET', '/api/health', () => ({ ok: true, pid: process.pid, db: engine.config.dbFile, worker: worker ? worker.id : null }));
  route('GET', '/api/workflows', () => [...engine.registry.values()].map(d => ({ name: d.name, version: d.version, codeHash: d.codeHash, title: d.title || null, sampleInput: d.sampleInput || {}, signals: d.signals || [] })));
  route('GET', '/api/runs', (req, q) => engine.store.listRuns({ status: q.get('status') || undefined, workflow: q.get('workflow') || undefined, limit: Math.min(500, Number(q.get('limit') || 100)) }));
  route('POST', '/api/runs', (req, q, body) => { const r = engine.start(body.workflow, body.input || {}, { runId: body.runId || undefined }); worker?.poke(); return r; });
  route('GET', '/api/runs/:id', (req, q, b, p) => engine.describe(decodeURIComponent(p.id)));
  route('POST', '/api/runs/:id/signal', (req, q, body, p) => { const r = engine.signal(decodeURIComponent(p.id), body.name, body.payload); worker?.poke(); return r; });
  route('POST', '/api/runs/:id/cancel', (req, q, b, p) => { const r = engine.cancel(decodeURIComponent(p.id)); worker?.poke(); return r; });
  route('POST', '/api/runs/:id/retry', (req, q, b, p) => { const r = engine.retry(decodeURIComponent(p.id)); worker?.poke(); return r; });
  route('GET', '/api/stats', () => ({ byStatus: engine.store.countByStatus(), tasks: engine.store.tasks().length, pendingTimers: engine.store.pendingTimers(10), workers: engine.store.workers(10), embeddedWorker: worker ? { id: worker.id, ...worker.stats, active: worker.active.size } : null }));
  route('GET', '/api/logs', (req, q) => { const n = Math.min(500, Number(q.get('limit') || 200)); const lv = q.get('level'); const runId = q.get('runId'); return logger.root.ring.filter(r => (!lv || r.level === lv) && (!runId || r.runId === runId)).slice(-n); });

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const t0 = Date.now();
    try {
      if (url.pathname.startsWith('/api/')) {
        const r = routes.find(rt => rt.method === req.method && rt.re.test(url.pathname));
        if (!r) return send(res, 404, { error: 'not found' });
        let body = {};
        if (req.method === 'POST') {
          const chunks = []; for await (const c of req) chunks.push(c);
          const txt = Buffer.concat(chunks).toString('utf8');
          if (txt) { try { body = JSON.parse(txt); } catch { return send(res, 400, { error: 'invalid JSON body' }); } }
        }
        const out = await r.fn(req, url.searchParams, body, url.pathname.match(r.re).groups || {});
        send(res, 200, out);
        log.debug('api', { method: req.method, path: url.pathname, ms: Date.now() - t0 });
        return;
      }
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      p = normalize(decodeURIComponent(p)).replace(/^([/\\])+/, '');
      if (p.includes('..')) return send(res, 400, { error: 'bad path' });
      const file = join(PUBLIC_DIR, p);
      const data = await readFile(file).catch(() => null);
      if (!data) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log.error('request failed', { path: url.pathname, err: e }); else log.info('request rejected', { path: url.pathname, status, msg2: e.message });
      send(res, status, { error: e.message, name: e.name });
    }
  }
  return createServer(handler);
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}
