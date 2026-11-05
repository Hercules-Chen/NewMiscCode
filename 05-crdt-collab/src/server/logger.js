// JSONL logger: one JSON object per line in <logDir>/server-YYYY-MM-DD.jsonl,
// plus a short human-readable line on stdout/stderr.
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export async function createLogger({ logDir, debug = false, quiet = false }) {
  await mkdir(logDir, { recursive: true });
  const minLevel = debug ? LEVELS.debug : LEVELS.info;
  let day = '';
  let stream = null;
  const file = () => join(logDir, `server-${day}.jsonl`);

  function getStream(ts) {
    const d = ts.slice(0, 10);
    if (d !== day || !stream) {
      if (stream) stream.end();
      day = d;
      stream = createWriteStream(file(), { flags: 'a', encoding: 'utf8' });
      stream.on('error', err => console.error('[collab] log write failed:', err.message));
    }
    return stream;
  }

  function log(level, event, fields = {}) {
    if (LEVELS[level] < minLevel) return;
    const ts = new Date().toISOString();
    const rec = { ts, level, event, ...fields };
    getStream(ts).write(JSON.stringify(rec) + '\n');
    if (!quiet) {
      const extra = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
      const line = `[collab] ${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event} ${extra}`;
      (level === 'error' || level === 'warn' ? console.error : console.log)(line);
    }
  }

  return {
    debug: (e, f) => log('debug', e, f),
    info: (e, f) => log('info', e, f),
    warn: (e, f) => log('warn', e, f),
    error: (e, f) => log('error', e, f),
    isDebug: debug,
    get file() { return file(); },
    close: () => new Promise(res => (stream ? stream.end(res) : res()))
  };
}
