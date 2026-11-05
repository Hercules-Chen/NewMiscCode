#!/usr/bin/env node
// apiguard CLI：diff / record / replay / mock / rules
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSpec } from './openapi/load.js';
import { diffSpecs } from './openapi/diff.js';
import { RULES } from './openapi/rules.js';
import { startRecorder } from './traffic/proxy.js';
import { readRecordings, replay } from './traffic/replay.js';
import { makeRedactor } from './traffic/redact.js';
import { startMock } from './mock/server.js';
import { buildReport, renderAs, renderConsole } from './report/render.js';
import { Logger, defaultDataDir, detectLang, VERSION } from './env.js';
import { t } from './i18n.js';

const FLAGS = new Set(['debug', 'help', 'version', 'no-color']);

export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { opt[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2);
      if (FLAGS.has(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) opt[k] = true;
      else opt[k] = argv[++i];
    } else if (a === '-h') opt.help = true;
    else pos.push(a);
  }
  return { cmd: pos[0], pos: pos.slice(1), opt };
}

const exists = p => access(p).then(() => true, () => false);

async function loadConfig(opt) {
  const file = opt.config ? resolve(opt.config) : resolve('apiguard.config.json');
  if (!opt.config && !(await exists(file))) return { file: null, cfg: {} };
  const cfg = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  return { file, cfg };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function emit(report, opt, lang, dataDir, prefix) {
  let format = opt.format;
  let out = typeof opt.out === 'string' ? resolve(opt.out) : null;
  if (!format && out) format = { '.json': 'json', '.md': 'md', '.html': 'html', '.htm': 'html' }[extname(out).toLowerCase()] || 'console';
  format = format || 'console';
  if (format !== 'console') {
    if (!out) out = join(dataDir, 'reports', `${prefix}-${stamp()}.${format === 'markdown' ? 'md' : format}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, renderAs(format, report, lang), 'utf8');
  }
  process.stdout.write(renderConsole(report, lang, { color: Boolean(process.stdout.isTTY && !opt['no-color'] && !process.env.NO_COLOR) }) + '\n');
  if (out) process.stdout.write(t(lang, 'report_written', { file: out }) + '\n');
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const { cmd, pos, opt } = parseArgs(argv);
  const { cfg, file: cfgFile } = await loadConfig(opt);
  const lang = detectLang(opt.lang || cfg.lang);
  if (opt.version) { console.log(VERSION); return 0; }
  if (!cmd || opt.help || cmd === 'help') { console.log(`apiguard ${VERSION}\n` + t(lang, 'usage')); return cmd || opt.help ? 0 : 2; }
  const dataDir = resolve(opt['data-dir'] || cfg.dataDir || defaultDataDir());
  const logger = new Logger({ dir: join(dataDir, 'logs'), level: opt.debug ? 'debug' : 'info', console: !!opt.debug });
  logger.info('cli.start', { cmd, version: VERSION, node: process.version, platform: process.platform, config: cfgFile, dataDir });
  if (opt.debug) process.stderr.write(t(lang, 'log_file', { file: logger.file }) + '\n');
  const failOn = opt['fail-on'] || cfg.failOn || 'breaking';

  try {
    if (cmd === 'diff') {
      if (pos.length < 2) throw usageError(lang);
      const [a, b] = await Promise.all([loadSpec(pos[0]), loadSpec(pos[1])]);
      const findings = diffSpecs(a.doc, b.doc);
      const report = buildReport({ kind: 'diff', findings, lang, inputs: { old: a.file, new: b.file },
        debug: { oldVersion: a.version, newVersion: b.version, oldRefs: a.refs, newRefs: b.refs, oldPaths: Object.keys(a.doc.paths || {}), newPaths: Object.keys(b.doc.paths || {}) } });
      logger.info('diff.done', report.summary);
      await emit(report, opt, lang, dataDir, 'diff');
      return failOn === 'none' || !report.summary.BREAKING ? 0 : 1;
    }
    if (cmd === 'record') {
      const target = opt.target || cfg.record?.target;
      if (!target) throw usageError(lang);
      const out = resolve(typeof opt.out === 'string' ? opt.out : join(dataDir, 'recordings', `recordings-${stamp()}.jsonl`));
      const rec = await startRecorder({ target, port: Number(opt.port ?? cfg.record?.port ?? 9000), host: opt.host || cfg.record?.host || '127.0.0.1', out, redact: cfg.redact, exclude: cfg.record?.exclude, logger });
      console.log(t(lang, 'rec_listening', { port: rec.port, target, out }));
      await new Promise(res => { process.once('SIGINT', res); process.once('SIGTERM', res); });
      await rec.close();
      console.log(t(lang, 'rec_stopped', { n: rec.count() }));
      await logger.flush();
      return 0;
    }
    if (cmd === 'replay') {
      const to = opt.to || cfg.replay?.to;
      if (!to || !pos[0]) throw usageError(lang);
      const recordings = await readRecordings(resolve(pos[0]));
      const options = { ...(cfg.replay || {}) };
      if (opt['array-order']) options.arrayOrder = opt['array-order'];
      if (opt['no-values'] !== undefined) options.compareValues = false;
      if (opt.header) {
        const h = String(opt.header); const i = h.indexOf(':');
        options.injectHeaders = { ...(options.injectHeaders || {}), [h.slice(0, i).trim()]: h.slice(i + 1).trim() };
      }
      const { exchanges, findings } = await replay({ to, recordings, options, logger, redactor: makeRedactor(cfg.redact || {}) });
      const report = buildReport({ kind: 'replay', findings, exchanges, lang, inputs: { recordings: resolve(pos[0]), to },
        debug: { options: { ...options, injectHeaders: options.injectHeaders ? Object.keys(options.injectHeaders) : undefined }, count: recordings.length } });
      logger.info('replay.done', report.summary);
      await emit(report, opt, lang, dataDir, 'replay');
      return failOn === 'none' || !report.summary.BREAKING ? 0 : 1;
    }
    if (cmd === 'mock') {
      if (!pos[0]) throw usageError(lang);
      const spec = await loadSpec(pos[0]);
      const m = await startMock(spec.doc, { port: Number(opt.port ?? 4010), logger });
      console.log(t(lang, 'mock_listening', { port: m.port, n: m.routes }));
      await new Promise(res => { process.once('SIGINT', res); process.once('SIGTERM', res); });
      await m.close();
      return 0;
    }
    if (cmd === 'rules') {
      for (const [id, r] of Object.entries(RULES)) console.log(`${r.severity.padEnd(12)} ${id.padEnd(32)} ${lang === 'en' ? r.whyEn : r.whyZh}`);
      return 0;
    }
    throw usageError(lang);
  } catch (e) {
    logger.error('cli.error', { cmd, error: e.message, stack: opt.debug ? e.stack : undefined });
    console.error(e.code === 'E_USAGE' ? e.message : `apiguard: ${e.message}`);
    return 2;
  } finally {
    await logger.flush();
  }
}

function usageError(lang) { const e = new Error(t(lang, 'usage')); e.code = 'E_USAGE'; return e; }

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => { process.exitCode = code; });
}
