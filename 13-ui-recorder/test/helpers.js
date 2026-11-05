// Shared test helpers: static server for fixtures, 01 demo server, Playwright, child processes.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, VERIFIER_ROOT, loadPlaywright } from '../src/config.js';

export const FIXTURES = path.join(PROJECT_ROOT, 'test', 'fixtures');
export const TEST_OUT = path.join(PROJECT_ROOT, 'output', 'test');

export function serveDir(dir) {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(dir, rel.endsWith('/') ? rel + 'index.html' : rel);
    try {
      const body = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(rel === '/favicon.ico' ? 204 : 404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
  }));
}

/** Start 01-mcp-ui-verifier's demo site in-process (plain node http server, no dependencies). */
export async function startVerifierDemo() {
  const mod = await import(pathToFileURL(path.join(VERIFIER_ROOT, 'demo', 'server.js')).href);
  return mod.startDemoServer(0);
}

export function chromium() { return loadPlaywright().chromium; }

export function runNode(args, { cwd = PROJECT_ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

/** Replay a scenario file with 01's own CLI. */
export function replayWith01(file, baseUrl) {
  return runNode([path.join(VERIFIER_ROOT, 'src', 'cli.js'), 'run', file, '--base-url', baseUrl], { env: { UIV_OUTPUT_DIR: path.join(TEST_OUT, 'replay') } });
}
