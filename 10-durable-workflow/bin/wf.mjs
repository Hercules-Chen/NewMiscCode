#!/usr/bin/env node
// wf - command line for the durable workflow engine.
import { readFile } from 'node:fs/promises';
import { resolveConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { Engine, TERMINAL } from '../src/engine.js';
import { Worker } from '../src/worker.js';
import { demoWorkflows, loadWorkflowModule } from '../src/workflows/index.js';

const HELP = `wf - durable workflow engine (Node 22 + SQLite)

Usage:
  wf serve   [--port 8710] [--host 127.0.0.1] [--no-worker] [--open]   dashboard + REST API (+ embedded worker)
  wf worker  [--concurrency 4] [--lease-ms 15000]                       run a worker loop (Ctrl+C to stop)
  wf start   <workflow> [--input '{"k":1}' | --input-file f.json] [--id runId] [--wait]
  wf signal  <runId> <name> [--payload '{"approved":true}' | --payload-file f.json]
  wf status  [runId] [--status waiting] [--json]                      list runs or show one run's history
  wf cancel  <runId>
  wf retry   <runId>                                                  start a new run with the same input
  wf workflows                                                        list registered workflows

Global options:
  --data-dir <dir>   SQLite folder   (default: Windows %ProgramData%\\NewMiscCode\\10-durable-workflow\\data, else ./data)
  --log-dir <dir>    JSONL log folder (default: ...\\logs or ./logs)
  --db <file>        SQLite file (default: <data-dir>/workflow.db)
  --workflows <file> extra workflow module (exports "workflows" array)
  --debug            debug-level logs (also WF_DEBUG=1)
`;

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (v !== undefined) opt[key] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opt[key] = argv[++i];
      else opt[key] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

async function jsonArg(opt, name) {
  if (opt[name + 'File']) return JSON.parse((await readFile(opt[name + 'File'], 'utf8')).replace(/^﻿/, ''));
  if (opt[name] === undefined || opt[name] === true) return undefined;
  try { return JSON.parse(opt[name]); } catch { throw new Error(`--${name} is not valid JSON: ${opt[name]}`); }
}

const fmtTime = t => (t ? new Date(t).toLocaleString() : '-');

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift();
  if (!cmd || cmd === 'help' || opt.help) { process.stdout.write(HELP); return 0; }
  const longRunning = cmd === 'serve' || cmd === 'worker';
  const config = resolveConfig({ dataDir: opt.dataDir, logDir: opt.logDir, dbFile: opt.db, port: opt.port, host: opt.host, debug: !!opt.debug, leaseMs: opt.leaseMs, concurrency: opt.concurrency, pollMs: opt.pollMs, logToConsole: longRunning || !!opt.debug });
  const logger = new Logger({ logDir: config.logDir, debug: config.debug, toFile: config.logToFile, toConsole: config.logToConsole, component: 'wf' });
  const workflows = [...demoWorkflows];
  if (opt.workflows) workflows.push(...await loadWorkflowModule(opt.workflows));
  const engine = new Engine({ config, logger, workflows });
  const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o, null, 2)) + '\n');

  try {
    switch (cmd) {
      case 'serve': {
        const { createApp, listen } = await import('../src/server.js');
        const worker = opt.noWorker ? null : new Worker(engine, { logger }).start();
        const server = createApp({ engine, worker, logger });
        const port = await listen(server, config.port, config.host);
        const url = `http://${config.host}:${port}/`;
        logger.info('dashboard listening', { url, db: config.dbFile, logDir: config.logDir });
        out(`Dashboard: ${url}\nDatabase : ${config.dbFile}\nLogs     : ${config.logDir}`);
        if (opt.open) { const { exec } = await import('node:child_process'); exec(process.platform === 'win32' ? `start "" "${url}"` : `xdg-open ${url}`); }
        await waitForShutdown(async () => { server.close(); if (worker) await worker.stop(); });
        break;
      }
      case 'worker': {
        const worker = new Worker(engine, { logger }).start();
        out(`Worker ${worker.id} started. Database: ${config.dbFile}`);
        await waitForShutdown(() => worker.stop());
        break;
      }
      case 'start': {
        const name = pos[0];
        if (!name) throw new Error('usage: wf start <workflow> [--input JSON]');
        const def = engine.registry.get(name);
        const input = (await jsonArg(opt, 'input')) ?? (def && def.sampleInput) ?? {};
        const run = engine.start(name, input, { runId: typeof opt.id === 'string' ? opt.id : undefined });
        out(`started ${run.id} (${run.workflow})`);
        if (opt.wait) {
          let r = run;
          while (!TERMINAL.has(r.status)) { await new Promise(res => setTimeout(res, 500)); r = engine.store.getRun(run.id); }
          out({ id: r.id, status: r.status, result: r.result, error: r.error });
          return r.status === 'completed' ? 0 : 1;
        }
        break;
      }
      case 'signal': {
        const [runId, name] = pos;
        if (!runId || !name) throw new Error('usage: wf signal <runId> <name> [--payload JSON]');
        const r = engine.signal(runId, name, (await jsonArg(opt, 'payload')) ?? null);
        out(`signal "${name}" queued for ${runId} (id ${r.signalId})`);
        break;
      }
      case 'status': {
        if (pos[0]) {
          const d = engine.describe(pos[0]);
          if (opt.json) { out(d); break; }
          const r = d.run;
          out(`${r.id}  workflow=${r.workflow} v${r.version}  status=${r.status}${d.codeChanged ? '  (code changed since start)' : ''}`);
          out(`created ${fmtTime(r.created_at)}  updated ${fmtTime(r.updated_at)}`);
          if (r.waiting_on) out(`waiting on: ${r.waiting_on.map(w => `${w.kind}${w.name ? ' ' + w.name : ''}${w.until ? ' until ' + fmtTime(w.until) : ''}`).join(', ')}`);
          if (r.result !== undefined) out(`result: ${JSON.stringify(r.result)}`);
          if (r.error) out(`error: ${r.error.name}: ${r.error.message}`);
          out('history:');
          for (const e of d.events) out(`  #${String(e.id).padEnd(5)} ${new Date(e.ts).toISOString().slice(11, 23)}  seq=${String(e.seq ?? '-').padEnd(3)} ${e.type}${e.name ? ' ' + e.name : ''}`);
        } else {
          const runs = engine.store.listRuns({ status: typeof opt.status === 'string' ? opt.status : undefined, limit: Number(opt.limit || 30) });
          if (opt.json) { out(runs); break; }
          if (!runs.length) out('(no runs)');
          for (const r of runs) out(`${r.status.padEnd(10)} ${r.id.padEnd(34)} ${r.workflow.padEnd(16)} ${fmtTime(r.created_at)}`);
        }
        break;
      }
      case 'cancel': engine.cancel(pos[0]); out(`cancel requested for ${pos[0]}`); break;
      case 'retry': { const r = engine.retry(pos[0]); out(`started ${r.id} (retry of ${pos[0]})`); break; }
      case 'workflows': for (const d of engine.registry.values()) out(`${d.name.padEnd(16)} v${d.version}  hash=${d.codeHash}  ${(d.title && d.title['zh-TW']) || ''}`); break;
      default: process.stderr.write(`unknown command "${cmd}"\n\n${HELP}`); return 2;
    }
    return 0;
  } finally {
    await logger.flush();
    engine.close();
  }
}

function waitForShutdown(onStop) {
  return new Promise(resolve => {
    let stopping = false;
    const stop = async (sig) => {
      if (stopping) return; stopping = true;
      process.stdout.write(`\n${sig} received, shutting down...\n`);
      await onStop();
      resolve();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  });
}

main().then(code => { process.exitCode = code; }, err => { process.stderr.write(`error: ${err.message}\n`); if (process.env.WF_DEBUG === '1' || process.argv.includes('--debug')) process.stderr.write(err.stack + '\n'); process.exitCode = 1; });
