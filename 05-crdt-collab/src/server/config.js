// Command-line / environment configuration with OS-aware defaults.
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function defaultDataDir(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return join(env.ProgramData || 'C:\\ProgramData', 'NewMiscCode', '05-crdt-collab');
  }
  return join(PROJECT_ROOT, 'data');
}

const HELP = `crdt-collab server

Usage: node src/server/index.js [options]

  --port <n>          HTTP/WebSocket port (default 8705, env COLLAB_PORT; 0 = random)
  --host <addr>       bind address (default 127.0.0.1, env COLLAB_HOST; 0.0.0.0 for LAN)
  --data-dir <dir>    document storage (env COLLAB_DATA_DIR)
                      default: Windows %ProgramData%\\NewMiscCode\\05-crdt-collab, others ./data
  --log-dir <dir>     JSONL logs (env COLLAB_LOG_DIR, default <data-dir>/logs)
  --compact-every <n> compact the append log into a snapshot after n updates (default 200)
  --debug             log debug level (each update, awareness, message sizes) (env COLLAB_DEBUG=1)
  --open              open the browser after start
  --help              show this help
`;

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const cfg = {
    port: env.COLLAB_PORT != null ? Number(env.COLLAB_PORT) : 8705,
    host: env.COLLAB_HOST || '127.0.0.1',
    dataDir: env.COLLAB_DATA_DIR || '',
    logDir: env.COLLAB_LOG_DIR || '',
    compactEvery: 200,
    debug: env.COLLAB_DEBUG === '1' || env.COLLAB_DEBUG === 'true',
    open: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--port': cfg.port = Number(next()); break;
      case '--host': cfg.host = next(); break;
      case '--data-dir': cfg.dataDir = next(); break;
      case '--log-dir': cfg.logDir = next(); break;
      case '--compact-every': cfg.compactEvery = Math.max(1, Number(next())); break;
      case '--debug': cfg.debug = true; break;
      case '--open': cfg.open = true; break;
      case '--help': case '-h': cfg.help = true; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw new Error(`invalid port: ${cfg.port}`);
  cfg.dataDir = resolve(cfg.dataDir || defaultDataDir());
  cfg.logDir = resolve(cfg.logDir || join(cfg.dataDir, 'logs'));
  return cfg;
}

export { HELP };
