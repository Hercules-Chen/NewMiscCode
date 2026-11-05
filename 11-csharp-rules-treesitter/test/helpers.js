import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { run } from '../src/engine.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLES = join(ROOT, 'samples');

let cached = null;
/** Run the engine on samples/ with samples/csrules.json (cached across tests in one file). */
export async function scanSamples() {
  if (!cached) {
    cached = (async () => {
      const { config } = await loadConfig({ searchDirs: [SAMPLES] });
      return run({ targets: [SAMPLES], config });
    })();
  }
  return cached;
}

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

/** Collect "// expect: R1, R1" markers from sample .cs files -> sorted ["file:line:rule", ...] */
export async function expectedMarkers(root = SAMPLES) {
  const out = [];
  for await (const p of walk(root)) {
    if (!p.endsWith('.cs') || p.includes('encoding-bad')) continue;
    const lines = (await readFile(p, 'utf8')).split(/\r?\n/);
    lines.forEach((l, i) => {
      const m = /\/\/ expect: ([R\d, ]+)/.exec(l);
      if (m) for (const id of m[1].match(/R\d+/g)) out.push(`${relative(root, p).replace(/\\/g, '/')}:${i + 1}:${id}`);
    });
  }
  return out.sort();
}

export const key = f => `${f.file}:${f.line}:${f.ruleId}`;

/** Run the CLI as a child process. */
export function cli(args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [join(ROOT, 'src/cli.js'), ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', rej);
    p.on('close', code => res({ code, stdout, stderr }));
  });
}
