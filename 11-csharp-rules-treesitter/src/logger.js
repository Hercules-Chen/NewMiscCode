// JSONL logger with levels. Default dir: Windows %ProgramData%\NewMiscCode\11-csharp-rules-treesitter, else ./logs
import { mkdir, appendFile } from 'node:fs/promises';
import { join, resolve, dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, off: 100 };
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function defaultLogDir(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const base = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
    return win32.join(base, 'NewMiscCode', '11-csharp-rules-treesitter');
  }
  return join(PROJECT_DIR, 'logs');
}

export async function createLogger({ dir, level = 'info', enabled = true } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const logDir = dir || defaultLogDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(logDir, `csrules-${stamp}.jsonl`);
  let ok = enabled && min < LEVELS.off;
  let queue = Promise.resolve();
  let lastError = null;
  if (ok) {
    try { await mkdir(logDir, { recursive: true }); }
    catch (e) { ok = false; lastError = e; }
  }
  const write = (lvl, msg, data) => {
    if (!ok || (LEVELS[lvl] ?? 0) < min) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, pid: process.pid, msg, ...(data || {}) }) + '\n';
    queue = queue.then(() => appendFile(file, line, 'utf8')).catch(e => { ok = false; lastError = e; });
  };
  return {
    file: ok ? file : null,
    get failure() { return lastError; },
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    flush: () => queue,
  };
}
