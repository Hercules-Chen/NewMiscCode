// Option parsing and OS-aware defaults.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLang } from './i18n.js';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Default output dir: %ProgramData%\NewMiscCode\01-mcp-ui-verifier on Windows, <project>/output elsewhere. */
export function defaultOutputDir() {
  if (process.env.UIV_OUTPUT_DIR) return path.resolve(process.env.UIV_OUTPUT_DIR);
  if (os.platform() === 'win32') {
    const base = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
    return path.join(base, 'NewMiscCode', '01-mcp-ui-verifier');
  }
  return path.join(PROJECT_ROOT, 'output');
}

const BOOL_FLAGS = new Set(['headed', 'devtools', 'debug', 'trace', 'help']);
const ALIASES = { h: 'help' };

/** Minimal argv parser: --key value, --key=value, --flag. Returns { _: [...positional], ...opts }. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      a = a.replace(/^-+/, '');
      let key = ALIASES[a] || a;
      let val;
      const eq = key.indexOf('=');
      if (eq >= 0) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      } else if (BOOL_FLAGS.has(key)) {
        val = true;
      } else {
        val = argv[i + 1];
        i++;
      }
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function envBool(name) {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

/** Merge CLI args + environment variables into a normalized options object. */
export function resolveOptions(args = {}) {
  const debug = Boolean(args.debug) || envBool('UIV_DEBUG');
  const devtools = Boolean(args.devtools) || envBool('UIV_DEVTOOLS');
  const headed = Boolean(args.headed) || envBool('UIV_HEADED') || debug || devtools;
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  return {
    lang: normalizeLang(args.lang || process.env.UIV_LANG || 'zh-TW'),
    outDir: path.resolve(args.out || defaultOutputDir()),
    baseUrl: args['base-url'] || process.env.UIV_BASE_URL || undefined,
    headed,
    devtools,
    debug,
    trace: Boolean(args.trace) || envBool('UIV_TRACE') || debug,
    slowMo: num(args.slowmo ?? process.env.UIV_SLOWMO, debug ? 250 : 0),
    timeout: num(args.timeout ?? process.env.UIV_TIMEOUT, 5000),
    cdpPort: args['cdp-port'] || process.env.UIV_CDP_PORT ? Number(args['cdp-port'] || process.env.UIV_CDP_PORT) : undefined,
    logLevel: args['log-level'] || process.env.UIV_LOG_LEVEL || (debug ? 'debug' : 'info'),
    browserPath: args['browser-path'] || process.env.UIV_BROWSER_PATH || undefined,
    viewport: { width: 1280, height: 800 },
  };
}
