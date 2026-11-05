'use strict';
// Shared configuration helpers (CommonJS so both the instrumented services and the ESM collector can use them).
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Default data folder: %ProgramData%\NewMiscCode\04-otel-trace-viewer on Windows, ./data elsewhere. */
function defaultDataDir() {
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
    return path.join(base, 'NewMiscCode', '04-otel-trace-viewer');
  }
  return path.join(PROJECT_ROOT, 'data');
}

/** Minimal argv parser: --key value, --key=value, --flag (boolean). */
function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}

function resolveConfig(args = parseArgs()) {
  const dataDir = path.resolve(String(args['data-dir'] || process.env.OTV_DATA_DIR || defaultDataDir()));
  const logDir = path.resolve(String(args['log-dir'] || process.env.OTV_LOG_DIR || path.join(dataDir, 'logs')));
  const debug = args.debug === true || args.debug === 'true' || process.env.OTV_DEBUG === '1';
  return { dataDir, logDir, debug, projectRoot: PROJECT_ROOT };
}

function intArg(v, def) {
  if (v === undefined || v === true) return def;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}

module.exports = { PROJECT_ROOT, defaultDataDir, parseArgs, resolveConfig, intArg };
