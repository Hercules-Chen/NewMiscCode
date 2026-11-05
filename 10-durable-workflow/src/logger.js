// JSONL logger: one JSON object per line, with level, component, runId/workflow ids.
// Keeps an in-memory ring buffer for the dashboard debug view.
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

export class Logger {
  constructor({ logDir, debug = false, toFile = true, toConsole = true, component = 'wf', ringSize = 500 } = {}) {
    this.level = debug ? LEVELS.debug : LEVELS.info;
    this.logDir = toFile && logDir ? logDir : null;
    this.toConsole = toConsole;
    this.component = component;
    this.ring = [];
    this.ringSize = ringSize;
    this._chain = Promise.resolve();
    this.root = this;
  }
  child(component) {
    const c = Object.create(this);
    c.component = component;
    return c;
  }
  log(level, msg, fields = {}) {
    if (LEVELS[level] < this.level) return;
    const rec = { ts: new Date().toISOString(), level, pid: process.pid, comp: this.component, msg, ...fields };
    if (rec.err instanceof Error) rec.err = { name: rec.err.name, message: rec.err.message, stack: rec.err.stack };
    const root = this.root;
    root.ring.push(rec);
    if (root.ring.length > root.ringSize) root.ring.shift();
    const line = JSON.stringify(rec);
    if (root.logDir) {
      const file = join(root.logDir, `wf-${rec.ts.slice(0, 10)}.jsonl`); // one file per UTC day
      root._chain = root._chain.then(() => appendFile(file, line + '\n')).catch(() => {});
    }
    if (this.toConsole) {
      const ids = [rec.runId && `run=${rec.runId}`, rec.workflow && `wf=${rec.workflow}`].filter(Boolean).join(' ');
      const errTxt = rec.err ? ' :: ' + (rec.err.message || rec.err) : '';
      const out = `${rec.ts} ${level.toUpperCase().padEnd(5)} [${rec.comp}] ${msg}${ids ? ' ' + ids : ''}${errTxt}`;
      (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(out + '\n');
    }
  }
  debug(m, f) { this.log('debug', m, f); }
  info(m, f) { this.log('info', m, f); }
  warn(m, f) { this.log('warn', m, f); }
  error(m, f) { this.log('error', m, f); }
  async flush() { await this.root._chain; }
}

export const nullLogger = new Logger({ toFile: false, toConsole: false });
