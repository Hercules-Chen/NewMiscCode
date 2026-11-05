// Structured JSONL logger with levels. Never writes to stdout (stdout is the MCP transport).
import fsp from 'node:fs/promises';
import path from 'node:path';

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Sink {
  constructor(file) {
    this.file = file;
    this.queue = fsp.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
  }
  write(line) {
    // Serialize appends so lines never interleave.
    this.queue = this.queue.then(() => fsp.appendFile(this.file, line, 'utf8')).catch(() => {});
    return this.queue;
  }
}

export class Logger {
  /**
   * @param {object} o
   * @param {string} o.file    JSONL file path
   * @param {string} [o.level] minimum level (debug|info|warn|error)
   * @param {boolean} [o.stderr] echo warn/error (all levels when level=debug) to stderr
   * @param {object} [o.base]  fields merged into every record
   */
  constructor({ file, level = 'info', stderr = false, base = {}, sink }) {
    this.file = file;
    this.level = level;
    this.min = LEVELS[level] ?? LEVELS.info;
    this.stderr = stderr;
    this.base = base;
    this.sink = sink || new Sink(file);
  }

  child(extra) {
    return new Logger({ file: this.file, level: this.level, stderr: this.stderr, base: { ...this.base, ...extra }, sink: this.sink });
  }

  log(level, msg, data) {
    if ((LEVELS[level] ?? 0) < this.min) return Promise.resolve();
    const rec = { ts: new Date().toISOString(), level, msg, ...this.base, ...(data || {}) };
    if (this.stderr && (LEVELS[level] >= LEVELS.warn || this.min <= LEVELS.debug)) {
      process.stderr.write(`[${level}] ${msg}${data ? ' ' + safeJson(data) : ''}\n`);
    }
    return this.sink.write(safeJson(rec) + '\n');
  }

  debug(m, d) { return this.log('debug', m, d); }
  info(m, d) { return this.log('info', m, d); }
  warn(m, d) { return this.log('warn', m, d); }
  error(m, d) { return this.log('error', m, d); }

  flush() { return this.sink.queue; }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return JSON.stringify({ unserializable: String(v) });
  }
}
