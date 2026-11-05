// JSONL logger with levels. Writes asynchronously to <logDir>/server-YYYY-MM-DD.jsonl.
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export async function createLogger({ logDir, debug = false, console: toConsole = true } = {}) {
  const min = debug ? LEVELS.debug : LEVELS.info;
  let stream = null;
  let file = null;
  if (logDir) {
    await mkdir(logDir, { recursive: true });
    file = join(logDir, `server-${new Date().toISOString().slice(0, 10)}.jsonl`);
    stream = createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  }
  const log = (level, msg, extra = {}) => {
    if (LEVELS[level] < min) return;
    const entry = { ts: new Date().toISOString(), level, msg, ...extra };
    if (stream) stream.write(JSON.stringify(entry) + '\n');
    if (toConsole) {
      const line = `${entry.ts} ${level.toUpperCase().padEnd(5)} ${msg}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`;
      (level === 'error' ? console.error : console.log)(line);
    }
  };
  return {
    file,
    debug: (m, e) => log('debug', m, e),
    info: (m, e) => log('info', m, e),
    warn: (m, e) => log('warn', m, e),
    error: (m, e) => log('error', m, e),
    close: () => new Promise(r => (stream ? stream.end(r) : r())),
  };
}
