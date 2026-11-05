// build-wasm.mjs - build crate/ for wasm32-unknown-unknown and copy to web/vr_core.wasm.
// Needs: rustup target add wasm32-unknown-unknown   (no wasm-bindgen / wasm-pack required)
import { spawn } from 'node:child_process';
import { copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { ROOT } from '../src/paths.js';

const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const local = join(homedir(), '.cargo', 'bin', exe);
const cargo = existsSync(local) ? local : 'cargo';
const args = ['build', '--release', '-j', '2', '--lib', '--target', 'wasm32-unknown-unknown', '--manifest-path', join(ROOT, 'crate', 'Cargo.toml')];
console.log(`[build-wasm] ${cargo} ${args.join(' ')}`);
const code = await new Promise(res => spawn(cargo, args, { stdio: 'inherit' }).on('close', res).on('error', e => { console.error(e.message); res(127); }));
if (code !== 0) {
  console.error('[build-wasm] cargo failed. If the target is missing run: rustup target add wasm32-unknown-unknown');
  process.exit(code || 1);
}
const src = join(ROOT, 'crate', 'target', 'wasm32-unknown-unknown', 'release', 'vr_core.wasm');
const dst = join(ROOT, 'web', 'vr_core.wasm');
await copyFile(src, dst);
const { size } = await stat(dst);
console.log(`[build-wasm] ${dst} ${size} bytes${size > 2 * 1024 * 1024 ? ' (WARNING: > 2MB)' : ''}`);
