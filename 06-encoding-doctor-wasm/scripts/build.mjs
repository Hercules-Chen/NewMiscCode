// Build script: Go -> WebAssembly (web/encdoc.wasm), copies wasm_exec.js from
// the Go installation, and builds the native CLI (bin/encdoc[.exe]).
// Usage: node scripts/build.mjs [--wasm-only] [--cli-only] [--windows] [--all-platforms]
//   --windows        also cross-compile bin/encdoc.exe (GOOS=windows GOARCH=amd64)
//   --all-platforms  windows/amd64, linux/amd64, darwin/arm64 into bin/
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

function findGo() {
  const cands = [process.env.GO, 'go', '/usr/local/go/bin/go', 'C:\\Program Files\\Go\\bin\\go.exe'].filter(Boolean);
  for (const c of cands) {
    try { execFileSync(c, ['version'], { stdio: 'pipe' }); return c; } catch { /* next */ }
  }
  console.error('[build] Go not found. Install Go 1.24+ from https://go.dev/dl/ (or set GO=path\\to\\go)');
  process.exit(2);
}
const GO = findGo();
const goVersion = execFileSync(GO, ['version'], { encoding: 'utf8' }).trim();
const goroot = execFileSync(GO, ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
console.log(`[build] ${goVersion}  GOROOT=${goroot}`);

function go(argv, env = {}) {
  console.log(`[build] go ${argv.join(' ')}  ${Object.entries(env).map(([k, v]) => k + '=' + v).join(' ')}`);
  execFileSync(GO, argv, { cwd: HERE, stdio: 'inherit', env: { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0', ...env } });
}
const size = p => (statSync(join(HERE, p)).size / 1024 / 1024).toFixed(2) + ' MB';

if (!args.has('--cli-only')) {
  go(['build', '-trimpath', '-ldflags=-s -w', '-o', 'web/encdoc.wasm', './cmd/wasm'], { GOOS: 'js', GOARCH: 'wasm' });
  const execSrc = [join(goroot, 'lib', 'wasm', 'wasm_exec.js'), join(goroot, 'misc', 'wasm', 'wasm_exec.js')].find(existsSync);
  if (!execSrc) { console.error('[build] wasm_exec.js not found in GOROOT'); process.exit(2); }
  copyFileSync(execSrc, join(HERE, 'web', 'wasm_exec.js'));
  console.log(`[build] web/encdoc.wasm ${size('web/encdoc.wasm')}; web/wasm_exec.js copied from ${execSrc}`);
}
if (!args.has('--wasm-only')) {
  mkdirSync(join(HERE, 'bin'), { recursive: true });
  const exe = process.platform === 'win32' ? 'bin/encdoc.exe' : 'bin/encdoc';
  go(['build', '-trimpath', '-ldflags=-s -w', '-o', exe, './cmd/encdoc']);
  console.log(`[build] ${exe} ${size(exe)}`);
  const targets = args.has('--all-platforms')
    ? [['windows', 'amd64', 'bin/encdoc.exe'], ['linux', 'amd64', 'bin/encdoc-linux-amd64'], ['darwin', 'arm64', 'bin/encdoc-darwin-arm64']]
    : args.has('--windows') && process.platform !== 'win32' ? [['windows', 'amd64', 'bin/encdoc.exe']] : [];
  for (const [os, arch, out] of targets) {
    go(['build', '-trimpath', '-ldflags=-s -w', '-o', out, './cmd/encdoc'], { GOOS: os, GOARCH: arch });
    console.log(`[build] ${out} ${size(out)}`);
  }
}
console.log('[build] done');
