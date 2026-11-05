// Workflow used by the crash-recovery test. Every activity appends a line to an
// "effects" file (path from WF_EFFECTS_FILE) so the test can count real side effects
// across process kills.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { defineWorkflow } from '../../src/engine.js';

const file = () => process.env.WF_EFFECTS_FILE;
const effect = line => appendFileSync(file(), line + '\n');
const effects = () => (existsSync(file()) ? readFileSync(file(), 'utf8').split('\n').filter(Boolean) : []);

export const crashDemo = defineWorkflow({
  name: 'crash-demo',
  async handler(ctx, input) {
    await ctx.step('s1', async () => { effect('s1'); return 1; });
    await ctx.step('s2', async () => { effect('s2'); return 2; });
    await ctx.sleep(input.sleepMs ?? 1500); // kill #1 happens while this durable timer is pending
    await ctx.step('s3', async () => { effect('s3'); return 3; });
    // Slow activity: kill #2 happens while it is running. Activities are at-least-once,
    // so it is made idempotent with the engine-provided idempotency key.
    await ctx.step('s4', async a => {
      effect(`s4-begin attempt=${a.attempt}`);
      await new Promise(r => setTimeout(r, input.slowMs ?? 1500));
      if (!effects().includes(`s4-commit ${a.idempotencyKey}`)) effect(`s4-commit ${a.idempotencyKey}`);
      return 4;
    });
    await ctx.step('s5', async () => { effect('s5'); return 5; });
    return 'done';
  },
});

export const workflows = [crashDemo];
