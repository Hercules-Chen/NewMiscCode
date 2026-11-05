#!/usr/bin/env node
// HTTP (static files + small JSON API) and WebSocket (/ws/<room>) server.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { parseArgs, HELP, PROJECT_ROOT } from './config.js';
import { createLogger } from './logger.js';
import { RoomManager } from './rooms.js';
import { ROOM_RE } from './store.js';

const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json; charset=utf-8'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  let file;
  try {
    file = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(PUBLIC_DIR + sep)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    if (pathname === '/dist/app.js') {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('client bundle missing: run "npm run build" first');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}

export async function startServer(cfg) {
  const log = await createLogger({ logDir: cfg.logDir, debug: cfg.debug, quiet: cfg.quiet });
  const rooms = new RoomManager({ dataDir: cfg.dataDir, log, compactEvery: cfg.compactEvery });
  const startedAt = Date.now();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p === '/api/health') {
        return sendJson(res, 200, { ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), rooms: rooms.rooms.size, ...rooms.stats, dataDir: cfg.dataDir, logFile: log.file });
      }
      const m = p.match(/^\/api\/rooms\/([^/]+)(\/versions(?:\/([^/]+))?)?$/);
      if (m) {
        const name = m[1];
        if (!ROOM_RE.test(name)) return sendJson(res, 400, { error: 'invalid room' });
        if (!m[2] && req.method === 'GET') return sendJson(res, 200, await rooms.roomStats(name));
        const room = await rooms.getRoom(name);
        if (m[2] && !m[3] && req.method === 'GET') return sendJson(res, 200, await room.store.listVersions());
        if (m[2] && !m[3] && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}');
          const entry = await room.store.saveVersion(room.doc, body.label, body.author);
          if (room.conns.size === 0) rooms.releaseRoom(room);
          return sendJson(res, 201, entry);
        }
        if (m[3] && req.method === 'GET') {
          const bin = await room.store.readVersion(m[3]);
          if (!bin) return sendJson(res, 404, { error: 'version not found' });
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
          return res.end(bin);
        }
        return sendJson(res, 405, { error: 'method not allowed' });
      }
      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      await serveStatic(req, res, p);
    } catch (err) {
      log.error('http.error', { path: p, error: String(err?.stack || err) });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!m || !ROOM_RE.test(m[1])) {
      log.warn('ws.rejected', { path: url.pathname });
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => rooms.handleConnection(ws, m[1], req.socket.remoteAddress));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, resolve);
  });
  const port = server.address().port;
  const url = `http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${port}/`;
  log.info('server.listening', { url, dataDir: cfg.dataDir, logDir: cfg.logDir, debug: cfg.debug, node: process.version });

  async function close() {
    log.info('server.shutdown', {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(r => server.close(r));
    await rooms.flushAll({ unload: true });
    await log.close();
  }
  return { server, port, url, close, rooms, log };
}

async function main() {
  let cfg;
  try {
    cfg = parseArgs();
  } catch (err) {
    console.error(`[collab] ${err.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (cfg.help) { console.log(HELP); return; }
  try { await stat(join(PUBLIC_DIR, 'dist', 'app.js')); } catch { console.warn('[collab] WARNING public/dist/app.js missing - run "npm run build"'); }
  const app = await startServer(cfg);
  console.log(`[collab] open ${app.url}`);
  if (cfg.open) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', app.url]] : process.platform === 'darwin' ? ['open', [app.url]] : ['xdg-open', [app.url]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
  let stopping = false;
  const stop = async sig => {
    if (stopping) return;
    stopping = true;
    console.log(`[collab] ${sig} received, flushing documents...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error('[collab] fatal', err); process.exit(1); });
}
