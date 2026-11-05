// Resolve data / log directories and runtime options (OS-aware defaults, overridable).
// Priority: explicit option > environment variable > OS default.
//   Windows: %ProgramData%\NewMiscCode\10-durable-workflow\{data,logs}
//   Others : ./data and ./logs (relative to the project folder)
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

export const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_ID = '10-durable-workflow';

export function defaultBaseDir() {
  if (process.platform === 'win32') {
    const pd = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
    return join(pd, 'NewMiscCode', APP_ID);
  }
  return PROJECT_DIR;
}

export function resolveConfig(opts = {}) {
  const env = process.env;
  const base = defaultBaseDir();
  const dataDir = resolve(opts.dataDir || env.WF_DATA_DIR || join(base, 'data'));
  const logDir = resolve(opts.logDir || env.WF_LOG_DIR || join(base, 'logs'));
  const cfg = {
    dataDir,
    logDir,
    dbFile: opts.dbFile || env.WF_DB || join(dataDir, 'workflow.db'),
    port: opts.port !== undefined ? Number(opts.port) : Number(env.WF_PORT || 8710),
    host: opts.host || env.WF_HOST || '127.0.0.1',
    debug: Boolean(opts.debug || env.WF_DEBUG === '1'),
    leaseMs: Number(opts.leaseMs || env.WF_LEASE_MS || 15000),
    pollMs: Number(opts.pollMs || env.WF_POLL_MS || 250),
    concurrency: Number(opts.concurrency || env.WF_CONCURRENCY || 4),
    logToFile: opts.logToFile !== false,
    logToConsole: opts.logToConsole !== undefined ? opts.logToConsole : true,
  };
  mkdirSync(cfg.dataDir, { recursive: true });
  if (cfg.logToFile) mkdirSync(cfg.logDir, { recursive: true });
  return cfg;
}
