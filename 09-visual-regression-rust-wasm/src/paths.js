// paths.js - OS-aware default locations (output, logs, baseline) and project paths.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const PROJECT_ID = '09-visual-regression-rust-wasm';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WASM_PATH = join(ROOT, 'web', 'vr_core.wasm');

/**
 * Default output dir: Windows -> %ProgramData%\NewMiscCode\09-visual-regression-rust-wasm,
 * other OS -> <project>/output. Override with --out-dir or env VR_OUTPUT_DIR.
 */
export function defaultOutDir(env = process.env, platform = process.platform) {
  if (env.VR_OUTPUT_DIR) return resolve(env.VR_OUTPUT_DIR);
  if (platform === 'win32') return join(env.ProgramData || 'C:\\ProgramData', 'NewMiscCode', PROJECT_ID);
  return join(ROOT, 'output');
}

/** Path of the native CLI built by `cargo build --release` (null when not built). */
export function nativeBinary() {
  const p = join(ROOT, 'crate', 'target', 'release', process.platform === 'win32' ? 'vr-native.exe' : 'vr-native');
  return existsSync(p) ? p : null;
}
