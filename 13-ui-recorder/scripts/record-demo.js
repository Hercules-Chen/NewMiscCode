// Interactive demo: start 01-mcp-ui-verifier's demo site, open a headed recorder on it,
// save to <output>/scenarios/demo-recorded.json when you press "Stop & save".
// Usage: node scripts/record-demo.js [--lang en] [--debug] [--port 4173]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERIFIER_ROOT, defaultOutputDir, parseArgs } from '../src/config.js';
import { main } from '../src/cli.js';

const args = parseArgs(process.argv.slice(2));
const { startDemoServer } = await import(pathToFileURL(path.join(VERIFIER_ROOT, 'demo', 'server.js')).href);
const srv = await startDemoServer(Number(args.port ?? 4173));
console.log(`Demo site: ${srv.url}`);
const rest = process.argv.slice(2).filter((a, i, all) => a !== '--port' && all[i - 1] !== '--port');
const out = args.out || path.join(defaultOutputDir(), 'scenarios', 'demo-recorded.json');
let code = 2;
try {
  code = await main(['record', srv.url, '--name', 'demo-recorded', '--out', out, ...rest.filter((a) => a !== '--out' && a !== args.out)]);
} finally {
  await srv.close();
}
process.exitCode = code;
