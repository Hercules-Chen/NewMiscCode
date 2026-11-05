// demo.mjs - end-to-end demo: screenshot demo/v1 -> approve as baseline -> screenshot demo/v2 -> report.
// Usage: node scripts/demo.mjs [--out-dir DIR] [--debug] [--lang en]
import { main } from '../src/cli.js';
import { join } from 'node:path';
import { ROOT } from '../src/paths.js';

const pass = process.argv.slice(2);
const step = async (title, argv) => {
  console.log(`\n=== ${title} ===`);
  const code = await main([...argv, ...pass]);
  console.log(`(exit code ${code})`);
  return code;
};
await step('1/3 v1 -> current (new)', ['run', '--site', join(ROOT, 'demo', 'v1')]);
await step('2/3 approve v1 as baseline', ['approve']);
const code = await step('3/3 v2 vs baseline (expect: changed)', ['run', '--site', join(ROOT, 'demo', 'v2')]);
process.exitCode = code === 1 ? 0 : 1;
