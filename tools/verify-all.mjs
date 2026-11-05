// Run every project's automated tests in sequence and print a summary table.
// Usage: node tools/verify-all.mjs [--install] [--only 01,03]
//   --install   run "npm ci" (or "npm install" when no lock file) before testing
// Exit code: 0 when every project passed, 1 otherwise.
import { readdir, access, mkdir, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const install = args.includes('--install');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? (args[onlyIdx + 1] || '').split(',').filter(Boolean) : null;
const exists = (p) => access(p).then(() => true, () => false);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const logDir = process.platform === 'win32'
  ? join(process.env.ProgramData || 'C:\\ProgramData', 'NewMiscCode', 'verify-all')
  : join(root, 'logs');
const logFile = join(logDir, `verify-all-${new Date().toISOString().slice(0, 10)}.jsonl`);

async function log(entry) {
  try { await mkdir(logDir, { recursive: true }); await appendFile(logFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* logging must not break the run */ }
}

function run(cmd, cmdArgs, cwd) {
  return new Promise((res) => {
    const t0 = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => res({ code: code ?? 1, ms: Date.now() - t0 }));
    child.on('error', (err) => { console.error(err.message); res({ code: 1, ms: Date.now() - t0 }); });
  });
}

console.log(`[verify-all] root=${root}`);
console.log(`[verify-all] node=${process.version} platform=${process.platform} install=${install} log=${logFile}`);
const projects = (await readdir(root, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
  .map((e) => e.name).sort()
  .filter((n) => !only || only.includes(n.slice(0, 2)));

const results = [];
for (const name of projects) {
  const dir = join(root, name);
  if (!(await exists(join(dir, 'package.json')))) { results.push({ name, status: 'SKIP', note: 'no package.json' }); continue; }
  console.log(`\n========== ${name} ==========`);
  if (install || !(await exists(join(dir, 'node_modules')))) {
    const hasLock = await exists(join(dir, 'package-lock.json'));
    const r = await run(npm, [hasLock ? 'ci' : 'install'], dir);
    await log({ project: name, step: 'install', code: r.code, ms: r.ms });
    if (r.code !== 0) { results.push({ name, status: 'FAIL', note: `npm install exit ${r.code}`, ms: r.ms }); continue; }
  }
  const r = await run(npm, ['test'], dir);
  await log({ project: name, step: 'test', code: r.code, ms: r.ms });
  results.push({ name, status: r.code === 0 ? 'PASS' : 'FAIL', note: `npm test exit ${r.code}`, ms: r.ms });
}

console.log('\n[verify-all] summary');
for (const r of results) console.log(`  ${r.status.padEnd(4)}  ${r.name.padEnd(30)}  ${(r.note || '').padEnd(20)}  ${r.ms ? (r.ms / 1000).toFixed(1) + ' s' : ''}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`[verify-all] projects=${results.length} failed=${failed} exit=${failed ? 1 : 0}`);
process.exit(failed ? 1 : 0);
