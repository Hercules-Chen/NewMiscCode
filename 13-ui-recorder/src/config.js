// Option parsing, OS-aware defaults and Playwright loading.
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { normalizeLang } from './i18n.js';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Sibling project whose scenario format we produce (used by tests and docs). */
export const VERIFIER_ROOT = path.resolve(PROJECT_ROOT, '..', '01-mcp-ui-verifier');

/** Default output/log dir: %ProgramData%\NewMiscCode\13-ui-recorder on Windows, <project>/output elsewhere. */
export function defaultOutputDir() {
  if (process.env.UIREC_OUTPUT_DIR) return path.resolve(process.env.UIREC_OUTPUT_DIR);
  if (os.platform() === 'win32') {
    const base = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
    return path.join(base, 'NewMiscCode', '13-ui-recorder');
  }
  return path.join(PROJECT_ROOT, 'output');
}

const BOOL_FLAGS = new Set(['debug', 'help', 'headless', 'headed', 'check-console']);

/** Minimal argv parser: --key value, --key=value, --flag. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { out.help = true; continue; }
    if (a.startsWith('--')) {
      let key = a.slice(2);
      let val;
      const eq = key.indexOf('=');
      if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
      else if (BOOL_FLAGS.has(key)) val = true;
      else { val = argv[i + 1]; i++; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

const envBool = (n) => ['1', 'true', 'yes'].includes(String(process.env[n] || '').toLowerCase());

export function resolveOptions(args = {}) {
  const debug = Boolean(args.debug) || envBool('UIREC_DEBUG');
  const outDir = defaultOutputDir();
  return {
    lang: normalizeLang(args.lang || process.env.UIREC_LANG || 'zh-TW'),
    debug,
    logLevel: args['log-level'] || process.env.UIREC_LOG_LEVEL || (debug ? 'debug' : 'info'),
    outDir,
    logDir: path.join(outDir, 'logs'),
    out: args.out ? path.resolve(String(args.out)) : null,
    name: args.name ? String(args.name) : undefined,
    script: args.script ? path.resolve(String(args.script)) : null,
    // --script runs headless unless --headed; interactive recording is always headed.
    headless: args.script ? !args.headed : Boolean(args.headless),
    debounceMs: Number(args.debounce ?? 400),
  };
}

let pw;
/** Load Playwright: global install / NODE_PATH first, then 01-mcp-ui-verifier/node_modules as a fallback. */
export function loadPlaywright() {
  if (pw) return pw;
  const req = createRequire(import.meta.url);
  const tries = ['playwright', path.join(VERIFIER_ROOT, 'node_modules', 'playwright')];
  for (const t of tries) {
    try { pw = req(t); return pw; } catch { /* try next */ }
  }
  try {
    const { execSync } = req('node:child_process');
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    pw = req(path.join(root, 'playwright'));
    return pw;
  } catch {
    throw new Error('Playwright not found. Install it globally (npm i -g playwright) or run 01-mcp-ui-verifier setup.');
  }
}
