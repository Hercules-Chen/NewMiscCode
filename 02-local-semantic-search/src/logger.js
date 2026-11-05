// JSONL structured logger with levels, file sink, console sink and an in-memory ring buffer
// (the ring buffer is what /api/debug exposes in the web UI).
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 99 };
const RING_MAX = 300;

export class Logger {
  constructor({ logDir, debug = false, consoleLevel, fileLevel, name = 'lss' } = {}) {
    this.name = name;
    this.consoleLevel = LEVELS[consoleLevel || process.env.LSS_LOG_LEVEL || (debug ? 'debug' : 'warn')] ?? LEVELS.warn;
    this.fileLevel = LEVELS[fileLevel || (debug ? 'debug' : 'info')] ?? LEVELS.info;
    this.ring = [];
    this.stream = null;
    this.filePath = null;
    if (logDir) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        this.filePath = path.join(logDir, `${name}-${day}.jsonl`);
        this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
        this.stream.on('error', () => { this.stream = null; });
      } catch { this.stream = null; }
    }
  }

  log(level, event, fields = {}) {
    const lv = LEVELS[level] ?? LEVELS.info;
    if (fields.err instanceof Error) fields = { ...fields, err: { message: fields.err.message, stack: fields.err.stack } };
    const rec = { ts: new Date().toISOString(), level, pid: process.pid, event, ...fields };
    if (lv >= LEVELS.debug) { this.ring.push(rec); if (this.ring.length > RING_MAX) this.ring.shift(); }
    if (this.stream && lv >= this.fileLevel) this.stream.write(JSON.stringify(rec) + '\n');
    if (lv >= this.consoleLevel) {
      // console stays compact: stack traces only when the console level is debug or lower
      const shown = fields.err && this.consoleLevel > LEVELS.debug ? { ...fields, err: fields.err.message ?? fields.err } : fields;
      process.stderr.write(`[${level}] ${event} ${Object.keys(shown).length ? JSON.stringify(shown) : ''}\n`);
    }
  }
  trace(e, f) { this.log('trace', e, f); }
  debug(e, f) { this.log('debug', e, f); }
  info(e, f) { this.log('info', e, f); }
  warn(e, f) { this.log('warn', e, f); }
  error(e, f) { this.log('error', e, f); }
  recent(n = 100) { return this.ring.slice(-n); }
  async close() { if (this.stream) await new Promise((r) => this.stream.end(r)); this.stream = null; }
}

/** Silent logger for tests / library use. */
export const nullLogger = new Logger({ consoleLevel: 'silent', fileLevel: 'silent' });
