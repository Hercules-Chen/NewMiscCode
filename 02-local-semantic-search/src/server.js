// Minimal local HTTP server (node:http, no framework). Binds 127.0.0.1 by default.
//   GET /                -> public/index.html (search UI)
//   GET /api/search?q=&mode=&k=&perFile=
//   GET /api/stats
//   GET /api/preview     -> dry-run index plan (no writes)
//   GET /api/debug       -> config, stats, recent JSONL log entries (ring buffer)
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { Searcher } from './search.js';
import { previewIndex } from './indexer.js';

const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function startServer(cfg, logger, { port = cfg.port, host = cfg.host } = {}) {
  const searcher = new Searcher(cfg, logger);
  const startedAt = new Date().toISOString();

  const sendJson = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const handler = async (req, res) => {
    const t0 = performance.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return sendJson(res, 400, { error: 'missing q' });
        const r = await searcher.search(q, {
          mode: url.searchParams.get('mode') || 'hybrid',
          k: url.searchParams.get('k') || 10,
          perFile: url.searchParams.has('perFile') ? Number(url.searchParams.get('perFile')) : 1,
        });
        return sendJson(res, 200, r);
      }
      if (url.pathname === '/api/stats') return sendJson(res, 200, searcher.stats());
      if (url.pathname === '/api/preview') {
        const { root, note, plan } = await previewIndex(cfg, logger);
        const brief = Object.fromEntries(Object.entries(plan).map(([k, l]) => [k, l.map((f) => f.rel)]));
        return sendJson(res, 200, { root, note, plan: brief });
      }
      if (url.pathname === '/api/debug') {
        const n = Math.min(300, Number(url.searchParams.get('n')) || 100);
        let st = null;
        try { st = searcher.stats(); } catch (e) { st = { error: e.message }; }
        return sendJson(res, 200, {
          startedAt, node: process.version, platform: `${process.platform}/${process.arch}`, pid: process.pid,
          debug: cfg.debug, config: cfg, logFile: logger.filePath, stats: st,
          memoryMb: Math.round(process.memoryUsage().rss / 1048576), recentLogs: logger.recent(n),
        });
      }
      // static files
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
      const data = await fsp.readFile(file).catch(() => null);
      if (!data) return sendJson(res, 404, { error: 'not found', path: url.pathname });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (err) {
      logger.error('http.error', { path: url.pathname, err });
      sendJson(res, 500, { error: err.message });
    } finally {
      logger.debug('http.request', { method: req.method, path: url.pathname, query: url.search, status: res.statusCode, ms: Math.round(performance.now() - t0) });
    }
  };

  const server = http.createServer((req, res) => { handler(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actualPort = server.address().port;
  logger.info('server.listening', { host, port: actualPort });
  // Warm up the embedder in the background so the first query is fast.
  Promise.resolve().then(() => { searcher.open(); return searcher.getEmbedder(); }).catch((err) => logger.warn('server.warmup_failed', { err: err.message }));
  return {
    port: actualPort,
    server,
    close: () => new Promise((r) => server.close(() => { searcher.close(); r(); })),
  };
}
