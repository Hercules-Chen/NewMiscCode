#!/usr/bin/env node
// Entry point: node src/cli.js [--port 8808] [--data-dir DIR] [--debug]
import { parseArgs, HELP } from './config.js';

// node:sqlite prints an ExperimentalWarning on Node 22; hide only that one, keep all other warnings.
process.removeAllListeners('warning');
process.on('warning', (w) => { if (!(w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message))) console.warn(`${w.name}: ${w.message}`); });
const { createApp } = await import('./server.js');

let cfg;
try { cfg = parseArgs(); } catch (e) { console.error(e.message); console.error(HELP); process.exit(2); }
if (cfg.help) { console.log(HELP); process.exit(0); }

const app = await createApp({ dataDir: cfg.dataDir, logDir: cfg.logDir, debug: cfg.debug });
try {
  const url = await app.listen(cfg.port, cfg.host);
  const shown = url.replace('127.0.0.1', 'localhost');
  console.log(`\n  PWA offline sync  ->  ${shown}/\n  data: ${cfg.dataDir}\n  logs: ${cfg.logDir}\n  debug UI: ${shown}/?debug=1\n  Ctrl+C to stop\n`);
} catch (e) {
  app.log.error('listen failed', { err: e.message, port: cfg.port });
  console.error(e.code === 'EADDRINUSE' ? `Port ${cfg.port} is in use. Try --port 8809` : e.message);
  process.exit(1);
}
const shutdown = async sig => { app.log.info('shutdown', { sig }); await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
