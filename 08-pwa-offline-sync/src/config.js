// Configuration: CLI flags > environment variables > OS-aware defaults.
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_NAME = '08-pwa-offline-sync';

/** Default data dir: Windows -> %ProgramData%\NewMiscCode\08-pwa-offline-sync, others -> ./data */
export function defaultDataDir(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const base = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
    return join(base, 'NewMiscCode', APP_NAME);
  }
  return join(PROJECT_DIR, 'data');
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const cfg = {
    host: env.PWA_HOST || '127.0.0.1',
    port: env.PWA_PORT !== undefined ? Number(env.PWA_PORT) : 8808,
    dataDir: env.PWA_DATA_DIR || defaultDataDir(),
    logDir: env.PWA_LOG_DIR || '',
    debug: env.PWA_DEBUG === '1',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port' || a === '-p') cfg.port = Number(next());
    else if (a === '--host') cfg.host = next();
    else if (a === '--data-dir') cfg.dataDir = next();
    else if (a === '--log-dir') cfg.logDir = next();
    else if (a === '--debug') cfg.debug = true;
    else if (a === '--help' || a === '-h') cfg.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  cfg.dataDir = resolve(cfg.dataDir);
  cfg.logDir = resolve(cfg.logDir || join(cfg.dataDir, 'logs'));
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw new Error(`Invalid port: ${cfg.port}`);
  return cfg;
}

export const HELP = `pwa-offline-sync server

Usage: node src/cli.js [--port 8808] [--host 127.0.0.1] [--data-dir DIR] [--log-dir DIR] [--debug]

Env: PWA_PORT, PWA_HOST, PWA_DATA_DIR, PWA_LOG_DIR, PWA_DEBUG=1
Default data dir: Windows %ProgramData%\\NewMiscCode\\${APP_NAME}, others ./data
Logs: <data-dir>/logs/server-YYYY-MM-DD.jsonl
`;
