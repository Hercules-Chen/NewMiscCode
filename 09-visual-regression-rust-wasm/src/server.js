// server.js - tiny static server for the browser UI (web/), demo site (demo/), fixtures and docs.
// `/` redirects to /web/index.html. Only files under ALLOWED top-level folders are served.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { ROOT } from './paths.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const ALLOWED = new Set(['web', 'demo', 'examples', 'test', 'docs', 'README.html']);

export function startServer({ port = 5179, host = '127.0.0.1', log, extraRoots = {} } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') { res.writeHead(302, { location: '/web/index.html' }); res.end(); return; }
    const top = p.split('/')[1];
    let base = ROOT;
    if (extraRoots[top]) { base = extraRoots[top]; p = p.slice(top.length + 1) || '/'; }
    else if (!ALLOWED.has(top)) { res.writeHead(404); res.end('not found'); return; }
    const file = normalize(join(base, p));
    if (!file.startsWith(base + sep) && file !== base) { res.writeHead(403); res.end(); return; }
    try {
      let f = file;
      if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
      const body = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
      log?.debug('http', { path: url.pathname, status: 200 });
    } catch {
      res.writeHead(404); res.end('not found');
      log?.debug('http', { path: url.pathname, status: 404 });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const a = server.address();
      resolve({ server, port: a.port, url: `http://${host}:${a.port}`, close: () => new Promise(r => server.close(r)) });
    });
  });
}
