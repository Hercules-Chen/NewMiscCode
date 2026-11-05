#!/usr/bin/env node
// Tiny zero-dependency static server for the DuckDB-WASM dashboard.
// - correct MIME types (application/wasm etc.)
// - request log as JSONL (one file per day) in a configurable directory
//   default: Windows %ProgramData%\NewMiscCode\03-duckdb-wasm-dashboard, otherwise ./logs
//
// Usage: node server.js [--port 8703] [--host 127.0.0.1] [--root public] [--log-dir DIR] [--open]
// Env:   PORT, HOST, LOG_DIR
import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) out[key] = true; else { out[key] = next; i++; }
  }
  return out;
}

function defaultLogDir() {
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || 'C:\\ProgramData';
    return path.join(base, 'NewMiscCode', '03-duckdb-wasm-dashboard');
  }
  return path.join(HERE, 'logs');
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || process.env.PORT || 8703);
const HOST = String(args.host || process.env.HOST || '127.0.0.1');
const ROOT = path.resolve(HERE, String(args.root || 'public'));
const LOG_DIR = path.resolve(String(args['log-dir'] || process.env.LOG_DIR || defaultLogDir()));
const QUIET = !!args.quiet;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.parquet': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

let logReady = null;
async function writeLog(entry) {
  try {
    if (!logReady) logReady = fs.mkdir(LOG_DIR, { recursive: true });
    await logReady;
    const file = path.join(LOG_DIR, 'requests-' + entry.ts.slice(0, 10) + '.jsonl');
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    if (!writeLog.warned) { writeLog.warned = true; console.error('[server] cannot write log to', LOG_DIR, e.message); }
  }
}

async function handle(req, res) {
  const t0 = process.hrtime.bigint();
  let status = 200;
  let bytes = 0;
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      status = 405; res.writeHead(status, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { status = 403; res.writeHead(status); res.end('Forbidden'); return; }
    let st;
    try { st = await fs.stat(file); } catch { st = null; }
    if (st && st.isDirectory()) { status = 301; res.writeHead(status, { Location: url.pathname + '/' }); res.end(); return; }
    if (!st) {
      status = 404;
      const hint = rel.startsWith('/vendor/') ? ' (run "npm install && npm run build" first)' : '';
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + rel + hint);
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    bytes = st.size;
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    await new Promise((resolve, reject) => {
      const s = createReadStream(file);
      s.on('error', reject);
      res.on('close', resolve);
      s.pipe(res);
    });
  } catch (e) {
    status = 500;
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal error');
    console.error('[server] error', e);
  } finally {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const entry = { ts: new Date().toISOString(), method: req.method, path: url.pathname, status, bytes, ms: Math.round(ms * 10) / 10, ip: req.socket.remoteAddress, ua: req.headers['user-agent'] || '' };
    if (!QUIET) console.log(`${entry.ts} ${entry.method} ${entry.path} ${status} ${bytes}B ${entry.ms}ms`);
    writeLog(entry);
  }
}

function openBrowser(u) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
}

const server = http.createServer((req, res) => { handle(req, res); });
server.on('error', (e) => {
  console.error('[server] failed to start:', e.message);
  if (e.code === 'EADDRINUSE') console.error(`[server] port ${PORT} is in use; try --port ${PORT + 1}`);
  process.exit(1);
});
server.listen(PORT, HOST, async () => {
  const addr = server.address();
  const u = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${addr.port}/`;
  let vendorOk = true;
  try { await fs.access(path.join(ROOT, 'vendor', 'duckdb-eh.wasm')); } catch { vendorOk = false; }
  console.log(`[server] root    : ${ROOT}`);
  console.log(`[server] log dir : ${LOG_DIR}`);
  console.log(`[server] node    : ${process.version} on ${os.platform()}`);
  if (!vendorOk) console.log('[server] WARNING: public/vendor/ missing - run "npm install && npm run build"');
  console.log(`[server] listening ${u}`);
  console.log(`[server] debug   : ${u}?debug=1`);
  if (args.open) openBrowser(u);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
