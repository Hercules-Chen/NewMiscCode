// helpers.mjs - shared test helpers.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../src/paths.js';

export const FIX = join(ROOT, 'test', 'fixtures');
export const TEST_OUT = join(ROOT, 'output', 'test');
export const CLI = join(ROOT, 'src', 'cli.js');

/** Run a command, resolve {code, stdout, stderr} (never rejects on non-zero exit). */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 64 << 20, encoding: opts.encoding || 'utf8', ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 99) : 0, stdout, stderr });
    });
  });
}
export const vr = (...args) => run(process.execPath, [CLI, ...args]);

export function intersects(a, b, pad = 0) {
  return a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
}
