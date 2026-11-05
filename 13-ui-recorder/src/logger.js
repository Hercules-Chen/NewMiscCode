// JSONL logger with levels. One JSON object per line; never logs secret values.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export async function createLogger({ dir, level = 'info', name = 'recorder', echo = false } = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${name}-${stamp}.jsonl`);
  const stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, event, data) => {
    if ((LEVELS[lvl] ?? 0) < min) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, event, ...(data || {}) });
    stream.write(line + '\n');
    if (echo) console.error(`[${lvl}] ${event}${data ? ' ' + JSON.stringify(data) : ''}`);
  };
  return {
    file,
    debug: (e, d) => write('debug', e, d),
    info: (e, d) => write('info', e, d),
    warn: (e, d) => write('warn', e, d),
    error: (e, d) => write('error', e, d),
    close: () => new Promise((r) => stream.end(r)),
  };
}

/** No-op logger for the programmatic API when the caller does not pass one. */
export const nullLogger = { file: null, debug() {}, info() {}, warn() {}, error() {}, close: async () => {} };
