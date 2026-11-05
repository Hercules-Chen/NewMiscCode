#!/usr/bin/env node
// CLI: index | search | serve | stats
import { parseArgs } from 'node:util';
import { resolveConfig } from './config.js';
import { Logger } from './logger.js';
import { previewIndex, runIndex } from './indexer.js';
import { Searcher } from './search.js';

const HELP = `Local semantic search (FTS5 + sqlite-vec + multilingual-e5)

Usage:
  node src/cli.js index  [--dir <folder>] [--dry-run] [--rebuild] [--embedder e5|hash]
  node src/cli.js search <query> [--mode hybrid|keyword|semantic] [--k 10] [--json]
  node src/cli.js serve  [--port 8787] [--host 127.0.0.1]
  node src/cli.js stats

Global options:
  --data-dir <dir>   DB + logs location (default: Windows %ProgramData%\\NewMiscCode\\02-local-semantic-search, else ./data)
  --model-dir <dir>  local model root (default: ./models)
  --allow-remote     let transformers.js download the model from huggingface.co
  --debug            verbose JSONL logging (file + stderr)
  -h, --help
Debug Node with: node --inspect src/cli.js serve   (then open chrome://inspect)`;

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' }, 'dry-run': { type: 'boolean' }, rebuild: { type: 'boolean' }, embedder: { type: 'string' },
    mode: { type: 'string' }, k: { type: 'string' }, json: { type: 'boolean' }, 'per-file': { type: 'string' },
    port: { type: 'string' }, host: { type: 'string' },
    'data-dir': { type: 'string' }, 'model-dir': { type: 'string' }, 'allow-remote': { type: 'boolean' },
    debug: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});

const cmd = positionals[0];
if (v.help || !cmd) { console.log(HELP); process.exit(cmd || v.help ? 0 : 1); }

const cfg = resolveConfig({
  dataDir: v['data-dir'], modelDir: v['model-dir'], dir: v.dir, embedder: v.embedder,
  allowRemote: v['allow-remote'] || undefined, debug: v.debug, port: v.port, host: v.host,
});
const logger = new Logger({ logDir: cfg.logDir, debug: cfg.debug });
logger.debug('cli.start', { cmd, argv: process.argv.slice(2), cfg });

const ANSI = process.stdout.isTTY ? { b: '\x1b[1m', d: '\x1b[2m', y: '\x1b[33m', c: '\x1b[36m', r: '\x1b[0m' } : { b: '', d: '', y: '', c: '', r: '' };

async function main() {
  switch (cmd) {
    case 'index': {
      if (v['dry-run']) {
        const { root, dbPath, note, plan } = await previewIndex(cfg, logger);
        console.log(`[dry-run] docs=${root}\n[dry-run] db=${dbPath}${note ? `\n[dry-run] NOTE: ${note}` : ''}`);
        for (const [k, list] of Object.entries(plan)) for (const f of list) console.log(`  ${k.padEnd(9)} ${f.rel}`);
        console.log(`[dry-run] new=${plan.new.length} changed=${plan.changed.length} unchanged=${plan.unchanged.length} deleted=${plan.deleted.length} (nothing written)`);
        return 0;
      }
      console.log(`[index] docs=${cfg.docsDir}\n[index] db=${cfg.dbPath}`);
      const s = await runIndex(cfg, logger, {
        rebuild: v.rebuild, embedderName: v.embedder,
        onProgress: (p) => console.log(`  [${p.i}/${p.total}] ${p.path} (${p.chunks} chunks)`),
      });
      console.log(`[index] embedder=${s.embedder} added=${s.added} updated=${s.updated} touched=${s.touched} unchanged=${s.unchanged} deleted=${s.deleted} newChunks=${s.chunks} total(files=${s.stats.files}, chunks=${s.stats.chunks}, vectors=${s.stats.vectors}) ${s.ms}ms`);
      return 0;
    }
    case 'search': {
      const q = positionals.slice(1).join(' ').trim();
      if (!q) { console.error('search: missing <query>'); return 2; }
      const s = new Searcher(cfg, logger);
      try {
        const r = await s.search(q, { mode: v.mode, k: v.k, perFile: v['per-file'] != null ? Number(v['per-file']) : undefined });
        if (v.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
        console.log(`${ANSI.b}Query:${ANSI.r} ${q}  ${ANSI.d}(mode=${r.mode}, ${r.debug.totalMs}ms, embed ${r.debug.embedMs}ms, fts="${r.debug.ftsQuery ?? ''}")${ANSI.r}`);
        if (!r.results.length) console.log('  (no results)');
        for (const x of r.results) {
          const sc = x.scores;
          console.log(`${ANSI.b}${String(x.rank).padStart(2)}.${ANSI.r} ${ANSI.c}${x.path}${ANSI.r}:${x.line}  ${x.heading || x.title}`);
          console.log(`    ${ANSI.d}rrf=${sc.rrf} kw#=${sc.keywordRank ?? '-'} bm25=${sc.bm25 ?? '-'} sem#=${sc.semanticRank ?? '-'} cos=${sc.cosine ?? '-'} by=${x.matchedBy.join('+')}${ANSI.r}`);
          console.log(`    ${x.snippetText.replace(/\[([^\]]+)\]/g, `${ANSI.y}[$1]${ANSI.r}`)}`);
        }
        return 0;
      } finally { s.close(); }
    }
    case 'stats': {
      const s = new Searcher(cfg, logger);
      try { console.log(JSON.stringify({ dbPath: cfg.dbPath, logFile: logger.filePath, ...s.stats() }, null, 2)); } finally { s.close(); }
      return 0;
    }
    case 'serve': {
      const { startServer } = await import('./server.js');
      const srv = await startServer(cfg, logger);
      console.log(`[serve] http://${cfg.host}:${srv.port}/  (db=${cfg.dbPath}, log=${logger.filePath})`);
      const stop = async () => { await srv.close(); await logger.close(); process.exit(0); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      return null; // keep running
    }
    default:
      console.error(`Unknown command "${cmd}"\n\n${HELP}`);
      return 2;
  }
}

main().then(async (code) => {
  if (code === null) return;
  await logger.close();
  process.exitCode = code;
}).catch(async (err) => {
  logger.error('cli.error', { err });
  console.error(`ERROR: ${err.message}${cfg.debug ? '\n' + err.stack : ''}`);
  await logger.close();
  process.exitCode = 1;
});

