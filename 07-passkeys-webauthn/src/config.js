// Configuration: CLI args > environment variables > defaults.
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_DIR_NAME = '07-passkeys-webauthn';

/** OS-aware default data directory. Windows: %ProgramData%\NewMiscCode\07-passkeys-webauthn, else ./data */
export function defaultDataDir(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const base = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
    return join(base, 'NewMiscCode', APP_DIR_NAME);
  }
  return join(PROJECT_ROOT, 'data');
}

const HELP = `Usage: node src/cli.js [options]
  --port <n>          HTTP port (env PORT, default 3007)
  --host <h>          bind address (env HOST, default 127.0.0.1)
  --rp-id <id>        WebAuthn RP ID, e.g. localhost or example.com (env RP_ID, default localhost)
  --origin <url>      expected origin(s), comma separated (env ORIGIN, default http://localhost:<port>)
  --rp-name <name>    display name (env RP_NAME)
  --data-dir <dir>    SQLite + logs folder (env PK_DATA_DIR)
  --log-dir <dir>     JSONL log folder (env PK_LOG_DIR, default <data-dir>/logs)
  --debug             debug log level + /debug page (env PK_DEBUG=1)
  --require-uv        require user verification (UV flag) for login and registration
  --help`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=', 2);
    if (['debug', 'help', 'require-uv'].includes(k)) { out[k] = true; continue; }
    out[k] = inline ?? argv[++i];
  }
  return out;
}

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const a = parseArgs(argv);
  if (a.help) { console.log(HELP); process.exit(0); }
  const port = Number(a.port ?? env.PORT ?? 3007);
  const rpID = a['rp-id'] ?? env.RP_ID ?? 'localhost';
  const origins = String(a.origin ?? env.ORIGIN ?? `http://${rpID}:${port}`)
    .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const dataDir = resolve(a['data-dir'] ?? env.PK_DATA_DIR ?? defaultDataDir());
  const cfg = {
    port,
    host: a.host ?? env.HOST ?? '127.0.0.1',
    rpID,
    rpName: a['rp-name'] ?? env.RP_NAME ?? 'NewMiscCode Passkeys Demo',
    origins,
    dataDir,
    logDir: resolve(a['log-dir'] ?? env.PK_LOG_DIR ?? join(dataDir, 'logs')),
    debug: Boolean(a.debug || env.PK_DEBUG === '1'),
    requireUV: Boolean(a['require-uv'] || env.PK_REQUIRE_UV === '1'),
    secureCookies: origins.every(o => o.startsWith('https://')),
    challengeTtlMs: 5 * 60 * 1000,
    sessionTtlMs: 8 * 60 * 60 * 1000,
  };
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg) {
  for (const o of cfg.origins) {
    let u;
    try { u = new URL(o); } catch { throw new Error(`Invalid origin: ${o}`); }
    const host = u.hostname;
    if (host !== cfg.rpID && !host.endsWith('.' + cfg.rpID)) {
      throw new Error(`rpID "${cfg.rpID}" must equal or be a registrable suffix of origin host "${host}"`);
    }
    if (u.protocol !== 'https:' && host !== 'localhost' && !host.endsWith('.localhost')) {
      throw new Error(`Origin ${o} must use https:// (only localhost is a secure context over http)`);
    }
  }
  return true;
}
