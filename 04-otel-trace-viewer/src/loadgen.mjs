// Load generator: sends a weighted mix of requests to the gateway.
// Usage: node src/loadgen.mjs [--gateway http://127.0.0.1:3401] [--count 50] [--concurrency 4] [--slow-ms 1200]
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseArgs, intArg } = require('./common/config.cjs');

const ITEMS = ['widget', 'gadget', 'gizmo', 'doohickey'];

/** Pick a scenario. Mix: 70% checkout, 10% order lookup, 8% slow report, 7% error, 5% unknown item. */
function pick(i, slowMs) {
  const r = Math.random();
  if (r < 0.70) return { kind: 'checkout', path: `/api/checkout?item=${ITEMS[i % ITEMS.length]}&qty=${1 + (i % 5)}` };
  if (r < 0.80) return { kind: 'lookup', path: `/api/orders/${1 + (i % 10)}` };
  if (r < 0.88) return { kind: 'slow', path: `/api/slow?ms=${slowMs}` };
  if (r < 0.95) return { kind: 'error', path: '/api/error' };
  return { kind: 'unknown-item', path: '/api/checkout?item=unobtainium&qty=1' };
}

export async function runLoad({ gatewayUrl, count = 50, concurrency = 4, slowMs = 1200, onResult } = {}) {
  const summary = { total: 0, byKind: {}, byStatus: {}, failed: 0, ms: 0 };
  const t0 = Date.now();
  let next = 0;
  async function worker() {
    while (next < count) {
      const i = next++;
      const s = pick(i, slowMs);
      try {
        const res = await fetch(gatewayUrl + s.path);
        await res.arrayBuffer();
        summary.byStatus[res.status] = (summary.byStatus[res.status] || 0) + 1;
        onResult?.({ ...s, status: res.status });
      } catch (err) {
        summary.failed++;
        onResult?.({ ...s, error: err.message });
      }
      summary.total++;
      summary.byKind[s.kind] = (summary.byKind[s.kind] || 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  summary.ms = Date.now() - t0;
  return summary;
}

// Run as CLI only when this file is the entry point (case-insensitive on Windows drive letters).
const norm = (f) => (process.platform === 'win32' ? resolve(f).toLowerCase() : resolve(f));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  const args = parseArgs();
  const gatewayUrl = String(args.gateway || 'http://127.0.0.1:3401').replace(/\/$/, '');
  const verbose = Boolean(args.verbose);
  const summary = await runLoad({
    gatewayUrl, count: intArg(args.count, 50), concurrency: intArg(args.concurrency, 4), slowMs: intArg(args['slow-ms'], 1200),
    onResult: verbose ? (r) => console.log(`${r.kind.padEnd(13)} ${r.status ?? r.error} ${r.path}`) : undefined,
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.failed ? 1 : 0);
}
