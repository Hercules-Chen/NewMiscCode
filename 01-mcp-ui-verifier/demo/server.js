// Tiny static HTTP server for the demo site (no dependencies).
// Usage: node demo/server.js [port]   (default 4173; 0 = random free port)
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

export function startDemoServer(port = 4173, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (u.pathname === '/api/price') {
        res.writeHead(200, { 'content-type': MIME['.json'] });
        return res.end(JSON.stringify({ sku: 'NB-01', price: 1280 }));
      }
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(SITE, rel));
      if (!file.startsWith(SITE)) { res.writeHead(403); return res.end('forbidden'); }
      const body = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      resolve({ server, port: p, url: `http://${host}:${p}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.argv[2] ?? 4173);
  const s = await startDemoServer(port);
  console.log(`Demo site: ${s.url}  (Ctrl+C to stop)`);
}
