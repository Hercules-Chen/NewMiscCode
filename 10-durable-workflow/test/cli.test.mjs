// CLI smoke test: wf start / signal / status / worker as real child processes sharing one SQLite file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, waitFor } from './helpers.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = tempDir('wf-cli-');
after(() => tmp.cleanup());
const wf = (...args) => run(process.execPath, [join(ROOT, 'bin/wf.mjs'), ...args, '--data-dir', tmp.dir, '--log-dir', join(tmp.dir, 'logs')]);

test('wf start -> wf signal -> wf worker -> wf status', { timeout: 30000 }, async () => {
  const s = await wf('start', 'leave-approval', '--id', 'cli-leave-1', '--input', JSON.stringify({ employee: 'A', days: 1, approver: 'B', escalateTo: 'C', timeoutMs: 60000 }));
  assert.match(s.stdout, /started cli-leave-1/);
  const sig = await wf('signal', 'cli-leave-1', 'approval', '--payload', '{"approved":false,"by":"B"}');
  assert.match(sig.stdout, /signal "approval" queued/);
  const list = await wf('status', '--status', 'pending');
  assert.match(list.stdout, /pending\s+cli-leave-1/);
  const worker = spawn(process.execPath, [join(ROOT, 'bin/wf.mjs'), 'worker', '--data-dir', tmp.dir, '--log-dir', join(tmp.dir, 'logs'), '--poll-ms', '50'], { stdio: 'ignore' });
  try {
    const st = await waitFor(async () => { const r = await wf('status', 'cli-leave-1', '--json'); const d = JSON.parse(r.stdout); return d.run.status === 'completed' ? d : null; }, { timeout: 15000, interval: 200 });
    assert.equal(st.run.result.approved, false);
    const text = await wf('status', 'cli-leave-1');
    assert.match(text.stdout, /SignalReceived approval/);
    assert.match(text.stdout, /WorkflowCompleted/);
    const bad = await wf('signal', 'cli-leave-1', 'approval').then(() => null, e => e);
    assert.ok(bad && bad.code === 1 && /signal rejected/.test(bad.stderr), 'signal to a completed run is rejected');
  } finally { worker.kill('SIGTERM'); }
});
