// logger.js - JSONL logger with levels (debug < info < warn < error).
// File: <logDir>/vr-YYYY-MM-DD.jsonl ; console mirror on stderr (debug lines only with --debug).
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export async function createLogger({ dir, debug = false, quiet = false, component = 'cli' } = {}) {
  const minFile = debug ? LEVELS.debug : LEVELS.info;
  const minConsole = debug ? LEVELS.debug : LEVELS.warn;
  let stream = null;
  let file = null;
  if (dir) {
    await mkdir(dir, { recursive: true });
    file = join(dir, `vr-${new Date().toISOString().slice(0, 10)}.jsonl`);
    stream = createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  }
  const write = (level, msg, data) => {
    const rec = { ts: new Date().toISOString(), level, component, pid: process.pid, msg, ...(data || {}) };
    if (stream && LEVELS[level] >= minFile) stream.write(JSON.stringify(rec) + '\n');
    if (!quiet && LEVELS[level] >= minConsole) process.stderr.write(`[${level}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  };
  return {
    file,
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (c) => createChild(write, c),
    close: () => new Promise(res => (stream ? stream.end(res) : res())),
  };
}

function createChild(write, component) {
  const w = (level) => (m, d) => write(level, m, { sub: component, ...(d || {}) });
  return { debug: w('debug'), info: w('info'), warn: w('warn'), error: w('error') };
}
