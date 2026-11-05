// JSONL logger with levels. Never pass secrets (session tokens, private data) or full public keys at info.
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export async function createLogger({ logDir, debug = false, console: echo = true, file = true }) {
  const min = debug ? LEVELS.debug : LEVELS.info;
  let stream = null;
  let path = null;
  if (file) {
    await mkdir(logDir, { recursive: true });
    path = join(logDir, `app-${new Date().toISOString().slice(0, 10)}.jsonl`);
    stream = createWriteStream(path, { flags: 'a', encoding: 'utf8' });
  }
  const write = (level, msg, ctx = {}) => {
    if (LEVELS[level] < min) return;
    const rec = { ts: new Date().toISOString(), level, msg, ...ctx };
    const line = JSON.stringify(rec);
    if (stream) stream.write(line + '\n');
    if (echo) (level === 'error' ? console.error : console.log)(`[${level}] ${msg}${Object.keys(ctx).length ? ' ' + JSON.stringify(ctx) : ''}`);
  };
  return {
    path,
    debugEnabled: debug,
    debug: (m, c) => write('debug', m, c),
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
    close: () => new Promise(r => (stream ? stream.end(r) : r())),
  };
}

/** Shorten an identifier for logs: credential IDs are not secret, but keep logs compact. */
export const short = (s, n = 10) => (s ? String(s).slice(0, n) + '...' : s);
