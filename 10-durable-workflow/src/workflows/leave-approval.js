// 請假簽核：送出申請 → 等待主管核准訊號（逾時則升級給上一層主管）→ 再逾時則自動駁回。
// Leave approval: submit -> wait for "approval" signal; on timeout escalate; second timeout auto-rejects.
//
// Input: { employee, days, reason, approver, escalateTo, timeoutMs?, escalationTimeoutMs? }
// Signal "approval" payload: { approved: boolean, by: string, comment?: string }
import { defineWorkflow } from '../engine.js';

export const leaveApproval = defineWorkflow({
  name: 'leave-approval',
  version: '1',
  title: { 'zh-TW': '請假簽核（等待核准訊號，逾時升級）', en: 'Leave approval (wait for signal, escalate on timeout)' },
  sampleInput: { employee: '王小明', days: 2, reason: '家庭因素', approver: '陳經理', escalateTo: '林協理', timeoutMs: 120000, escalationTimeoutMs: 120000 },
  signals: ['approval'],
  async handler(ctx, input) {
    const request = await ctx.step('submitRequest', async () => ({ requestNo: `LV-${ctx.runId.slice(-6)}`, employee: input.employee, days: input.days }));
    await ctx.step('notifyApprover', async () => ({ notified: input.approver }));
    let decision;
    let escalated = false;
    try {
      decision = await ctx.waitForSignal('approval', { timeout: input.timeoutMs ?? 120000 });
    } catch (err) {
      if (err.name !== 'TimeoutError') throw err;
      escalated = true;
      await ctx.step('escalate', async () => ({ escalatedTo: input.escalateTo, reason: 'approver did not respond in time' }));
      try {
        decision = await ctx.waitForSignal('approval', { timeout: input.escalationTimeoutMs ?? 120000 });
      } catch (err2) {
        if (err2.name !== 'TimeoutError') throw err2;
        decision = { approved: false, by: 'system', comment: 'auto-rejected: no response after escalation' };
      }
    }
    const approved = !!(decision && decision.approved);
    if (approved) await ctx.step('recordLeave', async () => ({ booked: true, days: input.days }));
    await ctx.step('notifyEmployee', async () => ({ to: input.employee, approved }));
    return { requestNo: request.requestNo, approved, by: decision && decision.by, comment: decision && decision.comment, escalated };
  },
});
