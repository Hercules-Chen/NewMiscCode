#!/usr/bin/env node
// md2tabs CLI。 Usage: node src/cli.js build <file.md|folder> [--out x] [--check] [--embed-images] [--lang en] [--debug]
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { buildFile, buildFolder, isDirectory, EncodingError } from './build.js';
import { checkHtml } from './check.js';
import { messages } from './i18n.js';
import { Logger, VERSION, defaultLogDir, detectLang } from './env.js';

export function parseArgs(argv) {
  const o = { _: [], check: false, embedImages: false, allowInvalid: false, debug: false, log: true, maxImageKb: 1024 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`missing value for ${a}`); return v; };
    if (a === '--out' || a === '-o') o.out = val();
    else if (a === '--check') o.check = true;
    else if (a === '--embed-images') o.embedImages = true;
    else if (a === '--allow-invalid') o.allowInvalid = true;
    else if (a === '--debug') o.debug = true;
    else if (a === '--no-log') o.log = false;
    else if (a === '--lang') o.lang = val();
    else if (a === '--log-dir') o.logDir = val();
    else if (a === '--max-image-kb') o.maxImageKb = Number(val());
    else if (a === '--help' || a === '-h') o._.unshift('help');
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

const rel = p => relative(process.cwd(), p) || p;

export async function main(argv = process.argv.slice(2)) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`✖ ${e.message}`); return 2; }
  const lang = detectLang(o.lang);
  const t = messages(lang);
  const [cmd = 'help', target] = o._;
  const log = new Logger({ dir: o.log ? (o.logDir ? resolve(o.logDir) : defaultLogDir()) : null, level: o.debug ? 'debug' : 'info', echo: o.debug });
  const say = w => console.log(t[w.key](...w.args));
  try {
    if (cmd === 'help') { console.log(t.usage.replace('${v}', VERSION)); return 0; }
    if (cmd === 'version') { console.log(VERSION); return 0; }
    if (cmd !== 'build' && cmd !== 'check') { console.error(t.unknownCmd(cmd)); return 2; }
    if (!target) { console.error(t.noInput); return 2; }
    log.info('start', { cmd, target, version: VERSION, node: process.version, platform: process.platform, opts: { ...o, _: undefined } });

    if (cmd === 'check') {
      const file = resolve(target);
      const html = await readFile(file, 'utf8').catch(() => null);
      if (html === null) { console.error(t.notFound(target)); return 2; }
      return report(file, await checkHtml(html, { file }));
    }

    let outputs;
    if (await isDirectory(target)) {
      const r = await buildFolder(target, { ...o, log });
      if (!r.count) { console.error(t.noMd(target)); return 2; }
      for (const x of r.results) { x.warnings.forEach(say); console.log(t.built(rel(x.input), rel(x.output), x.tabs, x.bytes)); }
      if (r.index) console.log(t.index(rel(r.index.output), r.count));
      outputs = [...r.results, ...(r.index ? [r.index] : [])];
    } else {
      const x = await buildFile(target, { ...o, log }).catch(e => { if (e.code === 'ENOENT' && e.path === target) { console.error(t.notFound(target)); return null; } throw e; });
      if (!x) return 2;
      x.warnings.forEach(say);
      console.log(t.built(rel(x.input), rel(x.output), x.tabs, x.bytes));
      outputs = [x];
    }
    let code = 0;
    for (const x of outputs) {
      for (const p of x.problems) { console.error(t.writeAudit(rel(x.output), p)); code = 4; }
    }
    if (o.check) {
      for (const x of outputs) {
        const c = report(x.output, await checkHtml(x.html, { file: x.output }));
        if (c && !code) code = c;
      }
    }
    log.info('done', { code });
    return code;
  } catch (e) {
    if (e instanceof EncodingError) { console.error(t.invalid(e.input)); log.error('encoding', { input: e.input }); return 3; }
    console.error(t.ioError(e.message));
    log.error('failed', { message: e.message, stack: o.debug ? e.stack : undefined });
    return 4;
  } finally {
    await log.flush();
    if (o.debug && log.file) console.error(t.logAt(log.file));
  }

  function report(file, { checks, problems }) {
    log.info('check', { file, checks, problems });
    if (!problems.length) { console.log(t.checkOk(rel(file), checks)); return 0; }
    console.error(t.checkFail(rel(file), problems.length));
    for (const p of problems) console.error('  - ' + p);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().then(code => { process.exitCode = code; });
}
