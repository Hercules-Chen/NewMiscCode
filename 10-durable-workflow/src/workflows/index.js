// Built-in demo workflows. Add your own here, or load a module with `wf worker --workflows <file>`.
import { orderSaga } from './order-saga.js';
import { leaveApproval } from './leave-approval.js';
import { batchReport } from './batch-report.js';

export const demoWorkflows = [orderSaga, leaveApproval, batchReport];

/** Load extra workflows from a module that exports `workflows` (array) or default array. */
export async function loadWorkflowModule(file) {
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const m = await import(pathToFileURL(resolve(file)).href);
  const list = m.workflows || m.default;
  if (!Array.isArray(list)) throw new Error(`${file} must export "workflows" (array of defineWorkflow(...))`);
  return list;
}
