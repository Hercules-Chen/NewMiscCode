// R1: no sync-over-async (.GetAwaiter().GetResult(), .Result, .Wait(), Task.WaitAll/WaitAny)
import { compact, isAssignmentTarget } from './util.js';

const TASK_TYPE = /^(System\.Threading\.Tasks\.)?(Task|ValueTask)(<.*>)?\??$/;
const TASK_FACTORY = /(^|\.)(Task\.Run|Task\.Factory\.StartNew|Task\.WhenAll|Task\.WhenAny|Task\.FromResult)$|Async$/;

function taskNames(ctx) {
  const names = new Set();
  for (const m of ctx.matches('task-decls')) {
    if (m.type && m.name && TASK_TYPE.test(compact(m.type.text))) names.add(m.name.text);
    if (m.var_name && m.init_callee && TASK_FACTORY.test(compact(m.init_callee.text).replace(/<.*>$/, ''))) names.add(m.var_name.text);
  }
  return names;
}

function isTaskLike(receiver, names, nameRx) {
  if (!receiver) return false;
  if (receiver.type === 'invocation_expression') {
    const fn = receiver.childForFieldName('function');
    return !!fn && TASK_FACTORY.test(compact(fn.text).replace(/<.*>$/, ''));
  }
  if (receiver.type === 'parenthesized_expression') return isTaskLike(receiver.namedChild(0), names, nameRx);
  let id = receiver;
  if (receiver.type === 'member_access_expression') id = receiver.childForFieldName('name');
  if (!id || id.type !== 'identifier') return false;
  return names.has(id.text) || nameRx.test(id.text);
}

export default {
  id: 'R1',
  queries: ['R1-sync-over-async', 'task-decls'],
  check(ctx) {
    const cfg = ctx.cfg;
    const names = taskNames(ctx);
    const nameRx = new RegExp(cfg.taskNamePattern || '(?!)');
    const getResultNodes = new Set();
    for (const m of ctx.matches('R1-sync-over-async')) {
      if (m.get_result) {
        getResultNodes.add(m.get_result.id);
        const inner = m.get_result.childForFieldName('function').childForFieldName('expression').childForFieldName('function').childForFieldName('expression');
        ctx.report(m.get_result, 'R1.getResult', {}, `await ${inner.text}`);
      } else if (m.result) {
        const p = m.result.parent;
        if (p && p.type === 'invocation_expression' && p.childForFieldName('function')?.id === m.result.id) continue; // x.Result()
        if (isAssignmentTarget(m.result)) continue;
        if (!cfg.strictResult && !isTaskLike(m.receiver, names, nameRx)) { ctx.debugSkip(m.result, 'receiver not task-like'); continue; }
        ctx.report(m.result, 'R1.result', { expr: m.result.text }, `(await ${m.receiver.text})`);
      } else if (m.wait) {
        if (!isTaskLike(m.receiver, names, nameRx)) { ctx.debugSkip(m.wait, 'receiver not task-like'); continue; }
        ctx.report(m.wait, 'R1.wait', { expr: m.wait.text }, `await ${m.receiver.text};`);
      } else if (m.wait_all) {
        const isAll = m.wait_all.text.includes('WaitAll');
        const alt = isAll ? 'Task.WhenAll(...)' : 'Task.WhenAny(...)';
        const args = m.wait_all.childForFieldName('arguments')?.text || '()';
        ctx.report(m.wait_all, 'R1.waitAll', { expr: compact(m.wait_all.childForFieldName('function').text), alt }, `await Task.${isAll ? 'WhenAll' : 'WhenAny'}${args};`);
      }
    }
  },
};
