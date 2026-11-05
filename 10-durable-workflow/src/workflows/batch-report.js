// 批次報表：多個步驟之間有 durable sleep，適合示範「中途 kill worker 再重啟」的復原。
// Batch report: steps separated by durable sleeps - good for the kill-and-restart demo.
// Input: { parts?: number, sleepMs?: number }
import { defineWorkflow } from '../engine.js';

export const batchReport = defineWorkflow({
  name: 'batch-report',
  version: '1',
  title: { 'zh-TW': '批次報表（步驟間 durable sleep，示範 kill/重啟）', en: 'Batch report (durable sleeps; kill/restart demo)' },
  sampleInput: { parts: 4, sleepMs: 5000 },
  async handler(ctx, input) {
    const parts = input.parts ?? 4;
    const startedAt = await ctx.now();
    const rows = [];
    for (let i = 1; i <= parts; i++) {
      const r = await ctx.step(`buildPart${i}`, async () => ({ part: i, rows: 100 * i }));
      rows.push(r.rows);
      if (i < parts) await ctx.sleep(input.sleepMs ?? 5000);
    }
    const finishedAt = await ctx.now();
    return { parts, totalRows: rows.reduce((a, b) => a + b, 0), elapsedMs: finishedAt - startedAt };
  },
});
