// Crash recovery: a real worker child process (bin/wf.mjs worker) is SIGKILLed twice
// mid-workflow and restarted; the run must complete with no duplicate side effects
// for steps that had already completed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { tempDir, makeEngine, waitFor, waitTerminal, eventTypes } from './helpers.mjs';
import { workflows } from './fixtures/crash-workflows.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = tempDir('wf-crash-');
after(() => tmp.cleanup());

function spawnWorker(dataDir, effectsFile) {
  const child = spawn(process.execPath, [join(ROOT, 'bin/wf.mjs'), 'worker', '--data-dir', dataDir, '--log-dir', join(dataDir, 'logs'),
    '--workflows', join(ROOT, 'test/fixtures/crash-workflows.mjs'), '--lease-ms', '1000', '--poll-ms', '50', '--debug'], {
    env: { ...process.env, WF_EFFECTS_FILE: effectsFile }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', d => { child.output += d; });
  child.stderr.on('data', d => { child.output += d; });
  child.exited = new Promise(r => child.on('exit', (code, signal) => r({ code, signal })));
  return child;
}

test('worker killed (SIGKILL) during a durable sleep and during an activity; restarts resume from history', { timeout: 60000 }, async () => {
  const dataDir = join(tmp.dir, 'data');
  const effectsFile = join(tmp.dir, 'effects.txt');
  process.env.WF_EFFECTS_FILE = effectsFile;
  const engine = makeEngine(join(dataDir, 'workflow.db'), workflows); // client only (no worker in this process)
  const lines = () => (existsSync(effectsFile) ? readFileSync(effectsFile, 'utf8').split('\n').filter(Boolean) : []);
  const run = engine.start('crash-demo', { sleepMs: 1500, slowMs: 1500 });

  // 1st worker: kill while the durable timer is pending
  let w = spawnWorker(dataDir, effectsFile);
  await waitFor(() => eventTypes(engine, run.id).includes('TimerStarted'), { timeout: 15000, msg: 'timer started' });
  w.kill('SIGKILL');
  const ex1 = await w.exited;
  assert.equal(ex1.signal, 'SIGKILL');
  assert.deepEqual(lines(), ['s1', 's2']);

  // 2nd worker: must wait for the lease to expire, then replay s1/s2 from history; kill during slow s4
  w = spawnWorker(dataDir, effectsFile);
  await waitFor(() => lines().some(l => l.startsWith('s4-begin')), { timeout: 15000, msg: 's4 begin' });
  w.kill('SIGKILL');
  await w.exited;
  assert.ok(!lines().some(l => l.startsWith('s4-commit')), 's4 was interrupted before commit');

  // 3rd worker: completes the run
  w = spawnWorker(dataDir, effectsFile);
  const done = await waitTerminal(engine, run.id, 20000);
  w.kill('SIGTERM');
  await w.exited;
  const out = w.output;
  const hist = engine.store.history(run.id);
  engine.close();

  assert.equal(done.status, 'completed', out);
  assert.equal(done.result, 'done');
  const L = lines();
  const count = p => L.filter(l => l === p || l.startsWith(p + ' ')).length;
  assert.equal(count('s1'), 1, 's1 executed once'); assert.equal(count('s2'), 1, 's2 executed once');
  assert.equal(count('s3'), 1, 's3 executed once'); assert.equal(count('s5'), 1, 's5 executed once');
  assert.equal(count('s4-begin'), 2, 'interrupted activity s4 re-executed (at-least-once)');
  assert.equal(count('s4-commit'), 1, 'idempotency key prevents a duplicate s4 commit');
  assert.equal(hist.filter(e => e.type === 'StepStarted' && e.name === 's4').length, 2);
  assert.equal(hist.filter(e => e.type === 'StepCompleted').length, 5);
  assert.match(out, /recovered task from expired lease/, 'third worker logs the lease takeover');
});
