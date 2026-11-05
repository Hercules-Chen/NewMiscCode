#!/usr/bin/env node
// cli.js - `vr` command: compare | run | approve | serve | bench. All Node work is async.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCore } from './core.js';
import { createLogger } from './logger.js';
import { defaultOutDir, nativeBinary, ROOT } from './paths.js';
import { CLI_MSG } from './messages.js';
import { parseRect } from '../web/vrcore.js';

const execFileP = promisify(execFile);
const MULTI = new Set(['ignore', 'name']);
const BOOL = new Set(['debug', 'json', 'aa', 'help', 'quiet']);

export function parseArgs(argv) {
  const a = { _: [], ignore: [], name: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '-h') { a.help = true; continue; }
    if (!s.startsWith('--')) { a._.push(s); continue; }
    let [k, v] = s.slice(2).split(/=(.*)/s, 2);
    if (BOOL.has(k)) { a[k] = v === undefined ? true : v !== 'false'; continue; }
    if (v === undefined) { v = argv[++i]; if (v === undefined) throw new Error(`missing value for --${k}`); }
    if (MULTI.has(k)) a[k].push(v); else a[k] = v;
  }
  return a;
}

function num(v, name, min = 0, max = 1) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be a number within ${min}..${max}`);
  return n;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(e.message + '\n'); return 2; }
  const lang = (args.lang || process.env.VR_LANG || 'zh-TW') === 'en' ? 'en' : 'zh-TW';
  const M = CLI_MSG[lang];
  const cmd = args._.shift();
  if (!cmd || args.help || cmd === 'help') { console.log(M.usage); return cmd || args.help ? 0 : 2; }
  const outDir = resolve(args['out-dir'] || defaultOutDir());
  const log = await createLogger({ dir: join(outDir, 'logs'), debug: !!args.debug, component: cmd });
  log.debug('start', { argv, outDir, node: process.version, platform: process.platform });
  try {
    switch (cmd) {
      case 'compare': return await cmdCompare(args, M, log);
      case 'run': return await cmdRun(args, M, log, outDir, lang);
      case 'approve': return await cmdApprove(args, M, log, outDir);
      case 'serve': return await cmdServe(args, M, log);
      case 'bench': return await cmdBench(args, log, outDir);
      default: console.log(M.usage); return 2;
    }
  } catch (err) {
    log.error('fatal', { error: err.message, stack: args.debug ? err.stack : undefined });
    process.stderr.write(`[vr] ${M.error}: ${err.message}\n`);
    return 2;
  } finally {
    if (cmd !== 'serve') {
      if (args.debug && log.file) process.stderr.write(`[vr] ${M.log}: ${log.file}\n`);
      await log.close();
    }
  }
}

function compareOpts(args) {
  return {
    threshold: args.threshold != null ? num(args.threshold, 'threshold') : 0.1,
    includeAA: !!args.aa,
    gap: args.gap != null ? num(args.gap, 'gap', 0, 10000) : 8,
    ignore: args.ignore.map(parseRect),
  };
}

async function cmdCompare(args, M, log) {
  const [a, b] = args._;
  if (!a || !b) throw new Error('compare needs <baseline.png> <current.png>');
  const opts = compareOpts(args);
  const [ba, bb, core] = await Promise.all([readFile(a), readFile(b), loadCore()]);
  const { stats, diffPng, ms } = await core.compare(ba, bb, opts, { render: !!args.out });
  if (args.out) {
    await mkdir(dirname(resolve(args.out)), { recursive: true });
    await writeFile(args.out, diffPng);
  }
  log.info('compare', { baseline: a, current: b, ms: Math.round(ms * 100) / 100, diffPixels: stats.diffPixels, percent: stats.percent, boxes: stats.boxes, out: args.out });
  if (args.json) {
    console.log(JSON.stringify(stats));
  } else {
    console.log(`${stats.diffPixels > 0 ? M.changed : M.same}: diffPixels=${stats.diffPixels} (${stats.percent}%) boxes=${stats.boxes.length} aa=${stats.aaPixels} size=${stats.width}x${stats.height} ${ms.toFixed(1)}ms`);
    for (const bx of stats.boxes) console.log(`  box x=${bx.x} y=${bx.y} w=${bx.w} h=${bx.h} pixels=${bx.pixels}`);
    if (args.out) console.log(`${M.diffWritten}: ${resolve(args.out)}`);
  }
  return stats.diffPixels > 0 ? 1 : 0;
}

async function cmdRun(args, M, log, outDir, lang) {
  const { runSuite } = await import('./run.js');
  const configPath = resolve(args.config || join(ROOT, 'demo', 'vr.config.json'));
  const site = args.site || (args.config ? undefined : join(ROOT, 'demo', 'v1'));
  const r = await runSuite({
    configPath, site, outDir, baselineDir: args['baseline-dir'], lang, log,
    threshold: args.threshold != null ? num(args.threshold, 'threshold') : undefined,
    extraIgnore: args.ignore.map(parseRect),
  });
  for (const x of r.results) {
    console.log(`${x.status.padEnd(8)} ${x.name}${x.stats ? ` diffPixels=${x.stats.diffPixels} (${x.stats.percent}%) boxes=${x.stats.boxes.length}` : ''}${x.error ? ' ' + x.error : ''}`);
  }
  console.log(`${M.report}: ${r.reportPath}`);
  return r.exitCode;
}

async function cmdApprove(args, M, log, outDir) {
  const { approve } = await import('./run.js');
  const r = await approve({ outDir, baselineDir: args['baseline-dir'], names: args.name, log });
  if (!r.approved.length) { console.log(M.none); return 1; }
  console.log(`${M.approved}: ${r.approved.join(', ')} -> ${r.baselineDir}`);
  return 0;
}

async function cmdServe(args, M, log) {
  const { startServer } = await import('./server.js');
  const s = await startServer({ port: Number(args.port ?? 5179), host: args.host || '127.0.0.1', log });
  console.log(`${M.serving}: ${s.url}/web/index.html  (debug: ${s.url}/web/index.html?debug=1)`);
  console.log(`demo: ${s.url}/demo/v1/index.html  ${s.url}/demo/v2/index.html`);
  console.log(M.stop);
  log.info('serve', { url: s.url });
  await new Promise(() => {}); // run until Ctrl+C
  return 0;
}

/** WASM (in Node) vs native timing of the full pipeline: decode 2 PNG + compare + render + encode. */
async function cmdBench(args, log, outDir) {
  const iter = Math.max(1, Math.floor(num(args.iter ?? 10, 'iter', 1, 1000)));
  const native = nativeBinary();
  let [a, b] = args._;
  if (!a || !b) {
    if (!native) throw new Error('bench without inputs needs the native build to generate fixtures: npm run build:native');
    const dir = join(outDir, 'bench');
    await execFileP(native, ['gen-fixtures', dir]);
    [a, b] = [join(dir, 'big-a.png'), join(dir, 'big-b.png')];
  }
  const opts = compareOpts(args);
  const [ba, bb, core] = await Promise.all([readFile(a), readFile(b), loadCore()]);
  core.compareSync(ba, bb, opts); // warm-up
  const times = [];
  let stats;
  for (let i = 0; i < iter; i++) { const r = core.compareSync(ba, bb, opts); times.push(r.ms); stats = r.stats; }
  times.sort((x, y) => x - y);
  const wasm = { engine: 'wasm (Node ' + process.version + ')', iterations: iter, medianMs: +times[iter >> 1].toFixed(3), minMs: +times[0].toFixed(3) };
  const out = { input: { a, b, width: stats.width, height: stats.height, diffPixels: stats.diffPixels, boxes: stats.boxes.length }, wasm, native: null };
  if (native) {
    const flags = ['bench', a, b, '--iter', String(iter), '--threshold', String(opts.threshold), '--gap', String(opts.gap), ...opts.ignore.flatMap(r => ['--ignore', `${r.x},${r.y},${r.w},${r.h}`]), ...(opts.includeAA ? ['--aa'] : [])];
    const { stdout } = await execFileP(native, flags);
    out.native = JSON.parse(stdout.trim());
    out.ratio = +(wasm.medianMs / out.native.medianMs).toFixed(2);
  }
  log.info('bench', out);
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
if (process.argv[1] && norm(resolve(process.argv[1])) === norm(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code; });
}
