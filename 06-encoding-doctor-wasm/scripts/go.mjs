// Runs the Go toolchain even when "go" is not on PATH (npm scripts on Windows/Linux).
// Usage: node scripts/go.mjs test ./...
import { execFileSync, spawnSync } from 'node:child_process';
const cands = [process.env.GO, 'go', '/usr/local/go/bin/go', 'C:\\Program Files\\Go\\bin\\go.exe'].filter(Boolean);
const GO = cands.find(c => { try { execFileSync(c, ['version'], { stdio: 'pipe' }); return true; } catch { return false; } });
if (!GO) { console.error('[go.mjs] Go not found. Install Go 1.24+ (https://go.dev/dl/) or set GO=path/to/go'); process.exit(2); }
const r = spawnSync(GO, process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, GOTOOLCHAIN: 'local' } });
process.exit(r.status ?? 1);
