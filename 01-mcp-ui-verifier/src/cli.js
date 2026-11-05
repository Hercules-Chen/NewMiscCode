#!/usr/bin/env node
// CLI: run scenarios without MCP.
//   node src/cli.js run <scenario.json> [options]
//   node src/cli.js demo [options]
//   node src/cli.js serve-demo [--port 4173]
// Exit codes: 0 = all steps passed (demo: report produced), 1 = some steps failed, 2 = usage / runtime error.
import path from 'node:path';
import { parseArgs, resolveOptions, PROJECT_ROOT } from './config.js';
import { t } from './i18n.js';
import { runScenario, loadScenario } from './scenario.js';
import { startDemoServer } from '../demo/server.js';

function printStep(lang, rec) {
  const status = rec.status === 'pass' ? t(lang, 'report.pass') : rec.status === 'fail' ? t(lang, 'report.fail') : t(lang, 'report.skip');
  console.log(t(lang, 'cli.stepLine', { status, no: rec.no, action: rec.action, target: rec.target, ms: rec.durationMs, detail: rec.message }));
}

async function doRun(scenario, opts) {
  const lang = opts.lang;
  console.log(t(lang, 'cli.runStart', { name: scenario.name }));
  const res = await runScenario(scenario, opts, { onStep: (r) => printStep(lang, r) });
  const s = res.summary;
  console.log(t(lang, 'cli.summary', { passed: s.passed, failed: s.failed, skipped: s.skipped, total: s.total, ms: s.durationMs }));
  console.log(t(lang, 'cli.report', { path: res.reportPath }));
  console.log(t(lang, 'cli.log', { path: res.logFile }));
  if (res.tracePath) console.log(t(lang, 'cli.trace', { path: res.tracePath }));
  return res;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const opts = resolveOptions(args);
  opts.timeoutExplicit = args.timeout !== undefined;
  const cmd = args._[0];
  if (args.help || !cmd) {
    console.log(t(opts.lang, 'cli.usage'));
    return args.help ? 0 : 2;
  }
  try {
    if (cmd === 'run') {
      const file = args._[1];
      if (!file) { console.log(t(opts.lang, 'cli.usage')); return 2; }
      const sc = await loadScenario(path.resolve(file));
      const res = await doRun(sc, opts);
      return res.summary.ok ? 0 : 1;
    }
    if (cmd === 'demo') {
      const srv = await startDemoServer(Number(args.port ?? 0));
      console.log(t(opts.lang, 'cli.demoServer', { url: srv.url }));
      try {
        const sc = await loadScenario(path.join(PROJECT_ROOT, 'scenarios', 'demo.json'));
        opts.baseUrl = srv.url;
        console.log(t(opts.lang, 'cli.demoNote'));
        await doRun(sc, opts);
        return 0;
      } finally {
        await srv.close();
      }
    }
    if (cmd === 'serve-demo') {
      const srv = await startDemoServer(Number(args.port ?? 4173));
      console.log(t(opts.lang, 'cli.demoServer', { url: srv.url }));
      console.log(t(opts.lang, 'cli.serveHint'));
      await new Promise(() => {}); // run until Ctrl+C
    }
    console.log(t(opts.lang, 'cli.usage'));
    return 2;
  } catch (err) {
    console.error(t(opts.lang, 'cli.error', { message: err && err.message ? err.message : String(err) }));
    if (opts.debug) console.error(err);
    return 2;
  }
}

const code = await main();
process.exitCode = code;
