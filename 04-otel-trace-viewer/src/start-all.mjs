// Starts the whole local stack as child processes: collector(+viewer) -> pricing -> orders -> gateway.
// Usage: node src/start-all.mjs [--collector-port 4318] [--gateway-port 3401] [--orders-port 3402] [--pricing-port 3403]
//                               [--data-dir DIR] [--debug] [--load 30] [--inspect gateway] [--open]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
const { parseArgs, resolveConfig, intArg } = require('./common/config.cjs');
const SRC = fileURLToPath(new URL('.', import.meta.url));

function startChild(name, file, args, { env, inspect, quiet, timeoutMs = 20000 }) {
  const nodeArgs = ['--disable-warning=ExperimentalWarning'];
  if (inspect) nodeArgs.push(`--inspect=127.0.0.1:${inspect}`);
  const child = spawn(process.execPath, [...nodeArgs, resolve(SRC, file), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const output = [];
  return new Promise((resolveP, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not become ready in ${timeoutMs} ms\n${output.join('\n')}`)), timeoutMs);
    const onLine = (line, isErr) => {
      output.push(line);
      if (output.length > 200) output.shift();
      const m = /^OTV_READY (.*)$/.exec(line);
      if (m) { clearTimeout(timer); resolveP({ name, child, port: JSON.parse(m[1]).port, output }); return; }
      if (!quiet) (isErr ? process.stderr : process.stdout).write(`[${name}] ${line}\n`);
    };
    createInterface({ input: child.stdout }).on('line', (l) => onLine(l, false));
    createInterface({ input: child.stderr }).on('line', (l) => onLine(l, true));
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${name} exited early with code ${code}\n${output.join('\n')}`)); });
  });
}

/**
 * Start collector + 3 services. Ports default to 0 (random) when used from tests.
 * @returns {Promise<{collectorUrl:string, gatewayUrl:string, ordersUrl:string, pricingUrl:string, procs:object[], stop:()=>Promise<void>}>}
 */
export async function startStack({ dataDir, logDir, debug = false, quiet = false, ports = {}, inspect = '' } = {}) {
  const common = ['--data-dir', dataDir, '--log-dir', logDir, ...(debug ? ['--debug'] : [])];
  const procs = [];
  const ins = (svc) => (inspect === svc ? 9229 : 0);
  const stopOne = (p) => new Promise((r) => {
    if (p.child.exitCode !== null) return r();
    const t = setTimeout(() => { p.child.kill('SIGKILL'); r(); }, 5000);
    p.child.once('exit', () => { clearTimeout(t); r(); });
    try { p.child.send('shutdown'); } catch { p.child.kill(); }
  });
  // Services first (they flush spans + logs to the collector on shutdown), collector last.
  const stop = async () => {
    const services = procs.filter((p) => p.name !== 'collector');
    await Promise.all(services.map(stopOne));
    for (const p of procs.filter((x) => x.name === 'collector')) await stopOne(p);
  };
  try {
    const col = await startChild('collector', 'collector/server.mjs', [...common, '--port', String(ports.collector ?? 0)], { quiet, inspect: ins('collector') });
    procs.push(col);
    const collectorUrl = `http://127.0.0.1:${col.port}`;
    const svcArgs = [...common, '--collector', collectorUrl];
    const pricing = await startChild('pricing', 'services/pricing.cjs', [...svcArgs, '--port', String(ports.pricing ?? 0)], { quiet, inspect: ins('pricing') });
    procs.push(pricing);
    const pricingUrl = `http://127.0.0.1:${pricing.port}`;
    const orders = await startChild('orders', 'services/orders.cjs', [...svcArgs, '--port', String(ports.orders ?? 0), '--pricing', pricingUrl], { quiet, inspect: ins('orders') });
    procs.push(orders);
    const ordersUrl = `http://127.0.0.1:${orders.port}`;
    const gateway = await startChild('gateway', 'services/gateway.cjs', [...svcArgs, '--port', String(ports.gateway ?? 0), '--orders', ordersUrl], { quiet, inspect: ins('gateway') });
    procs.push(gateway);
    for (const p of procs) p.child.removeAllListeners('exit');
    return { collectorUrl, gatewayUrl: `http://127.0.0.1:${gateway.port}`, ordersUrl, pricingUrl, procs, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

// CLI entry
// Run as CLI only when this file is the entry point (case-insensitive on Windows drive letters).
const norm = (f) => (process.platform === 'win32' ? resolve(f).toLowerCase() : resolve(f));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  const args = parseArgs();
  const cfg = resolveConfig(args);
  const stack = await startStack({
    dataDir: cfg.dataDir, logDir: cfg.logDir, debug: cfg.debug, inspect: String(args.inspect || ''),
    ports: { collector: intArg(args['collector-port'], 4318), gateway: intArg(args['gateway-port'], 3401), orders: intArg(args['orders-port'], 3402), pricing: intArg(args['pricing-port'], 3403) },
  });
  console.log('');
  console.log('==================================================================');
  console.log(` Trace viewer / 追蹤檢視器 : ${stack.collectorUrl}/`);
  console.log(` OTLP endpoint            : ${stack.collectorUrl}/v1/traces (JSON)`);
  console.log(` gateway (demo entry)     : ${stack.gatewayUrl}/`);
  console.log(` data dir                 : ${cfg.dataDir}`);
  console.log(` log dir                  : ${cfg.logDir}`);
  console.log(' Press Ctrl+C to stop / 按 Ctrl+C 結束');
  console.log('==================================================================');
  const load = intArg(args.load, 0);
  if (load > 0) {
    const { runLoad } = await import('./loadgen.mjs');
    const summary = await runLoad({ gatewayUrl: stack.gatewayUrl, count: load, concurrency: 4 });
    console.log(`[loadgen] ${JSON.stringify(summary)}`);
  }
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('stopping...');
    await stack.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
