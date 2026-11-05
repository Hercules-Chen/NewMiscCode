#!/usr/bin/env node
// Entry point: node src/cli.js [--debug] [--port 3007] [--rp-id localhost] [--origin http://localhost:3007]
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { openStore } from './db.js';
import { createApp } from './server.js';

async function main() {
  const cfg = loadConfig();
  const log = await createLogger({ logDir: cfg.logDir, debug: cfg.debug });
  const store = await openStore(cfg.dataDir);
  const app = await createApp({ cfg, store, log });
  const port = await app.listen();
  log.info('server.start', { url: cfg.origins[0], bind: `${cfg.host}:${port}`, rpID: cfg.rpID, debug: cfg.debug, db: store.path, log: log.path });
  console.log(`\n  Passkeys demo: ${cfg.origins[0]}   (rpID=${cfg.rpID}${cfg.debug ? ', debug page: ' + cfg.origins[0] + '/debug' : ''})`);
  console.log(`  data: ${cfg.dataDir}\n  Ctrl+C to stop\n`);
  const shutdown = async sig => {
    log.info('server.stop', { sig });
    await app.close(); await store.close(); await log.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error('[fatal]', err.message); process.exit(1); });
