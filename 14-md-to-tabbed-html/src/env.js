// 共用環境：版本、日誌資料夾、JSONL 日誌、語言。 Shared env: version, log dir, JSONL logger, language.
import { mkdir, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const VERSION = '0.1.0';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 預設日誌資料夾：Windows = %ProgramData%\NewMiscCode\14-md-to-tabbed-html；其他 = <專案>/logs */
export function defaultLogDir(platform = os.platform(), env = process.env) {
  if (env.MD2TABS_LOG_DIR) return resolve(env.MD2TABS_LOG_DIR);
  if (platform === 'win32') {
    const base = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
    return join(base, 'NewMiscCode', '14-md-to-tabbed-html');
  }
  return join(PROJECT_ROOT, 'logs');
}

export function detectLang(argLang, env = process.env) {
  const v = String(argLang || env.MD2TABS_LANG || '').toLowerCase();
  return v.startsWith('en') ? 'en' : 'zh-TW';
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** JSONL logger：一行一筆 {ts, level, msg, data}。寫入失敗不會中斷建置。 */
export class Logger {
  constructor({ dir = null, level = 'info', echo = false, name = 'md2tabs' } = {}) {
    this.level = level;
    this.echo = echo;
    this.queue = Promise.resolve();
    this.file = dir ? join(dir, `${name}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`) : null;
  }
  log(level, msg, data) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const rec = { ts: new Date().toISOString(), level, msg, ...(data !== undefined ? { data } : {}) };
    const line = JSON.stringify(rec);
    if (this.echo) process.stderr.write(`[${level}] ${msg}${data !== undefined ? ' ' + JSON.stringify(data) : ''}\n`);
    if (!this.file) return;
    const file = this.file;
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, line + '\n', 'utf8');
    }).catch(() => {});
  }
  debug(m, d) { this.log('debug', m, d); }
  info(m, d) { this.log('info', m, d); }
  warn(m, d) { this.log('warn', m, d); }
  error(m, d) { this.log('error', m, d); }
  flush() { return this.queue; }
}

/** 不寫檔、不輸出的 logger（單元測試用）。 */
export const nullLogger = new Logger({ level: 'error' });
