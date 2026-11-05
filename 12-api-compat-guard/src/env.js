// 共用環境：資料夾位置、JSONL 日誌、語言。 Shared env: data dir, JSONL logger, language.
import { mkdir, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const VERSION = '0.1.0';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 預設資料夾：Windows = %ProgramData%\NewMiscCode\12-api-compat-guard；其他 = <專案>/data */
export function defaultDataDir(platform = os.platform(), env = process.env) {
  if (env.APIGUARD_DATA_DIR) return resolve(env.APIGUARD_DATA_DIR);
  if (platform === 'win32') {
    const base = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
    return join(base, 'NewMiscCode', '12-api-compat-guard');
  }
  return join(PROJECT_ROOT, 'data');
}

export function detectLang(argLang, env = process.env) {
  const v = String(argLang || env.APIGUARD_LANG || env.LANG || '').toLowerCase();
  if (v.startsWith('en')) return 'en';
  return 'zh-TW';
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * JSONL logger. 一行一筆 JSON。呼叫端必須只傳已遮罩（redacted）的資料；
 * logger 也會再次遮罩常見敏感欄位作為第二道防線。
 */
export class Logger {
  constructor({ dir, level = 'info', console: toConsole = false, name = 'apiguard' } = {}) {
    this.dir = dir;
    this.level = level;
    this.toConsole = toConsole;
    this.name = name;
    this.queue = Promise.resolve();
    this.file = dir ? join(dir, `${name}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`) : null;
  }
  log(level, msg, data) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const rec = { ts: new Date().toISOString(), level, msg, ...(data ? { data: scrub(data) } : {}) };
    const line = JSON.stringify(rec);
    if (this.toConsole) process.stderr.write(`[${level}] ${msg}${data ? ' ' + JSON.stringify(rec.data) : ''}\n`);
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

const SECRET_KEY = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|password|passwd|secret|token|access_token|refresh_token|api_key|apikey)$/i;
function scrub(v, depth = 0) {
  if (depth > 8 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => scrub(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? '***' : scrub(x, depth + 1);
  return out;
}

export const nullLogger = new Logger({});
