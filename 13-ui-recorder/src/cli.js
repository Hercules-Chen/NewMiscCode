#!/usr/bin/env node
// CLI: node src/cli.js record <url> [--out file.json] [--script steps.js] [--lang zh-TW|en] [--debug]
// Exit codes: 0 = scenario saved, 2 = usage / runtime error.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, resolveOptions, loadPlaywright } from './config.js';
import { t } from './i18n.js';
import { createLogger } from './logger.js';
import { startRecorder } from './recorder.js';
import { loadValidator } from './validate.js';

export async function record(url, opts, log) {
  const L = opts.lang;
  const { chromium } = loadPlaywright();
  console.log(t(L, 'cli.launch', { mode: t(L, opts.headless ? 'cli.headless' : 'cli.headed'), url }));
  const browser = await chromium.launch({ headless: opts.headless });
  log.info('browser.launched', { headless: opts.headless, version: browser.version() });
  try {
    const context = await browser.newContext({ viewport: opts.headless ? { width: 1280, height: 800 } : null });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') log.warn('page.console.error', { text: m.text() }); });
    page.on('pageerror', (e) => log.warn('page.error', { message: e.message }));
    const rec = await startRecorder(page, { lang: L, name: opts.name, logger: log, debounceMs: opts.debounceMs, checkConsole: opts.checkConsole });
    await page.goto(url);
    if (opts.script) {
      console.log(t(L, 'cli.script', { file: opts.script }));
      const mod = await import(pathToFileURL(opts.script).href);
      const fn = mod.default || mod.run;
      if (typeof fn !== 'function') throw new Error(`${opts.script}: export default async function ({ page, recorder }) is required`);
      await fn({ page, recorder: rec, url, log });
      await rec.stop('api');
    } else {
      console.log(t(L, 'cli.waiting'));
      await rec.waitForStop();
    }
    return rec.scenario();
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const opts = resolveOptions(args);
  opts.checkConsole = Boolean(args['check-console']);
  const cmd = args._[0];
  if (args.help || !cmd || cmd === 'help') { console.log(t(opts.lang, 'cli.usage')); return args.help || cmd === 'help' ? 0 : 2; }
  if (cmd !== 'record') { console.log(t(opts.lang, 'cli.usage')); return 2; }
  const url = args._[1];
  if (!url) { console.error(t(opts.lang, 'cli.noUrl')); return 2; }
  const log = await createLogger({ dir: opts.logDir, level: opts.logLevel, echo: opts.debug });
  log.info('cli.start', { argv, url, outDir: opts.outDir, platform: process.platform, node: process.version });
  try {
    const sc = await record(url, opts, log);
    const { validate, source } = await loadValidator();
    validate(sc, 'recorded');
    log.info('scenario.validated', { source, steps: sc.steps.length });
    const out = opts.out || path.join(opts.outDir, 'scenarios', `${sc.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, JSON.stringify(sc, null, 2) + '\n', 'utf8');
    log.info('scenario.saved', { file: out, steps: sc.steps.length });
    console.log(t(opts.lang, 'cli.saved', { count: sc.steps.length, file: out }));
    console.log(t(opts.lang, 'cli.validated') + (source === 'local' ? ' (local copy)' : ''));
    console.log(t(opts.lang, 'cli.replay', { file: out, base: sc.baseUrl || url }));
    console.log(t(opts.lang, 'cli.log', { file: log.file }));
    return 0;
  } catch (err) {
    log.error('cli.error', { message: err.message, stack: err.stack });
    console.error(t(opts.lang, 'cli.error', { message: err.message }));
    if (opts.debug) console.error(err);
    console.log(t(opts.lang, 'cli.log', { file: log.file }));
    return 2;
  } finally {
    await log.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = await main();
}
