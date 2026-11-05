// HTTP server: static app shell + REST API. No framework, async I/O, JSONL logging.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, normalize, extname, sep } from 'node:path';
import { openDb, HttpError } from './db.js';
import { createLogger } from './logger.js';
import { PROJECT_DIR } from './config.js';

export const PUBLIC_DIR = join(PROJECT_DIR, 'public');
const PKG = JSON.parse(await readFile(join(PROJECT_DIR, 'package.json'), 'utf8'));
export const APP_VERSION = PKG.version;

/** Files in the precached app shell. Their content hash becomes part of the SW build id. */
export const SHELL_FILES = [
  'index.html', 'css/app.css', 'js/app.js', 'js/i18n.js', 'js/outbox-core.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const MAX_BODY = 2 * 1024 * 1024;

export async function computeBuildId() {
  const h = createHash('sha256');
  for (const f of SHELL_FILES) {
    h.update(f);
    try { h.update(await readFile(join(PUBLIC_DIR, f))); } catch { h.update('missing'); }
  }
  h.update(await readFile(join(PUBLIC_DIR, 'sw.js')));
  return `${APP_VERSION}-${h.digest('hex').slice(0, 8)}`;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'body too large (max 2 MB)');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'invalid JSON'); }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

/**
 * Create (but do not yet listen) the app server.
 * @param {{dataDir?:string, logDir?:string, debug?:boolean, logToConsole?:boolean, buildId?:string, latencyMs?:number}} opts
 */
export async function createApp(opts = {}) {
  const log = await createLogger({ logDir: opts.logDir, debug: opts.debug, console: opts.logToConsole !== false });
  const store = await openDb(opts.dataDir);
  let buildId = opts.buildId || await computeBuildId();
  const stats = { started: new Date().toISOString(), requests: 0, replays: 0, conflicts: 0 };

  async function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 403, { error: 'forbidden' });
    let st;
    try { st = await stat(file); } catch { st = null; }
    if (!st || !st.isFile()) {
      // SPA fallback for navigations (Accept: text/html) to unknown paths
      if ((req.headers.accept || '').includes('text/html') && !extname(rel)) return serveStatic(req, res, '/');
      return send(res, 404, { error: 'not_found', path: pathname });
    }
    let body = await readFile(file);
    const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (rel === 'sw.js') {
      // Inject the build id; any change to shell files => new SW bytes => browser installs the update.
      body = Buffer.from(body.toString('utf8').replace('__BUILD_ID__', buildId));
      headers['Cache-Control'] = 'no-cache, no-store';
      headers['Service-Worker-Allowed'] = '/';
    }
    const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"';
    headers.ETag = etag;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const by = String(req.headers['x-client-id'] || '').slice(0, 64);
    const key = req.headers['idempotency-key'];
    if (parts[1] === 'health' && req.method === 'GET') {
      return send(res, 200, { ok: true, version: APP_VERSION, buildId, time: new Date().toISOString(), records: store.count(), stats });
    }
    if (parts[1] === 'log' && req.method === 'POST') {
      // Client-side error/diagnostic reports (from ?debug=1 or window.onerror)
      const b = await readBody(req);
      log[b.level === 'error' ? 'error' : 'info']('client', { client: by, msg: String(b.msg || '').slice(0, 2000), data: b.data });
      return send(res, 204, '');
    }
    if (parts[1] !== 'records') throw new HttpError(404, 'not_found', 'unknown API');
    const id = parts[2];
    if (!id && req.method === 'GET') {
      const since = url.searchParams.get('since') || undefined;
      return send(res, 200, { records: store.list({ since }), serverTime: new Date().toISOString() });
    }
    if (id && req.method === 'GET') {
      const r = store.get(id);
      return r ? send(res, 200, { record: r }) : send(res, 404, { error: 'not_found' });
    }
    const body = await readBody(req);
    const force = url.searchParams.get('force') === '1';
    let op;
    if (!id && req.method === 'POST') op = () => store.create(body, { by });
    else if (id && (req.method === 'PUT' || req.method === 'PATCH')) op = () => store.update(id, body, { by, force });
    else if (id && req.method === 'DELETE') op = () => store.update(id, { ...body, deleted: true }, { by, force });
    else throw new HttpError(405, 'method_not_allowed', 'method not allowed');
    const fingerprint = createHash('sha256').update(`${req.method} ${url.pathname}${force ? '?force' : ''}\n${JSON.stringify(body)}`).digest('hex');
    const r = store.idempotent(key, fingerprint, op);
    if (r.replayed) stats.replays++;
    if (r.status === 409) stats.conflicts++;
    log.info('mutation', { method: req.method, path: url.pathname, status: r.status, key, replayed: r.replayed, client: by, version: r.body?.record?.version ?? r.body?.server?.version });
    return send(res, r.status, r.body, r.replayed ? { 'Idempotent-Replayed': 'true' } : {});
  }

  const server = http.createServer(async (req, res) => {
    const t0 = performance.now();
    const reqId = randomUUID().slice(0, 8);
    stats.requests++;
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      if (opts.latencyMs) await new Promise(r => setTimeout(r, opts.latencyMs));
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url.pathname);
      else send(res, 405, { error: 'method_not_allowed' });
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.code, message: e.message, ...e.extra });
      else { log.error('unhandled', { reqId, err: e.stack || String(e) }); if (!res.headersSent) send(res, 500, { error: 'internal', reqId }); else res.end(); }
    } finally {
      log.debug('http', { reqId, method: req.method, path: url?.pathname || req.url, status: res.statusCode, ms: +(performance.now() - t0).toFixed(1) });
    }
  });

  return {
    server, store, log, stats,
    get buildId() { return buildId; },
    /** Change the SW build id at runtime (used by tests to simulate a deploy). */
    setBuildId(v) { buildId = v; log.info('buildId changed', { buildId }); },
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      const addr = server.address();
      this.url = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}`;
      log.info('listening', { url: this.url, buildId, db: store.file, logFile: log.file });
      return this.url;
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise(r => server.close(() => r()));
      store.close();
      await log.close();
    },
  };
}
