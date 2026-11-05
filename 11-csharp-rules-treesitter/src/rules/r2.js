// R2: prefer async — async void (except event handlers) and synchronous I/O in public methods.
import { compact, enclosingFunction, hasModifier, nameOf } from './util.js';

function isEventHandler(paramList) {
  const ps = paramList.namedChildren.filter(c => c.type === 'parameter');
  if (ps.length !== 2) return false;
  const t0 = compact(ps[0].childForFieldName('type')?.text || '');
  const t1 = compact(ps[1].childForFieldName('type')?.text || '');
  return /^(object|System\.Object|object\?)$/.test(t0) && /EventArgs(<.*>)?\??$/.test(t1);
}

export default {
  id: 'R2',
  queries: ['R2-prefer-async'],
  check(ctx) {
    const cfg = ctx.cfg;
    const ioRules = (cfg.syncIoCalls || []).map(r => ({ ...r, rx: r.receiver ? new RegExp(r.receiver, 'i') : null }));
    for (const m of ctx.matches('R2-prefer-async')) {
      if (m.async_void && cfg.asyncVoid !== false) {
        if (isEventHandler(m.params)) { ctx.debugSkip(m.async_void, 'event handler signature'); continue; }
        const mods = m.async_void.children.filter(c => c.type === 'modifier').map(c => c.text).join(' ');
        ctx.report(m.name, 'R2.asyncVoid', { name: m.name.text }, `${mods} Task ${m.name.text}${m.params.text}`);
      } else if (m.call && cfg.syncIo !== false) {
        const callee = compact(m.call.childForFieldName('function').text);
        const method = m.method.text;
        const hit = ioRules.find(r => r.call
          ? (callee === r.call || callee.endsWith('.' + r.call))
          : (r.method === method && (!r.rx || r.rx.test(compact(m.receiver.text)))));
        if (!hit) continue;
        // Enclosing *named* method (lambdas inherit the method they live in)
        let fn = enclosingFunction(m.call);
        while (fn && (fn.type === 'lambda_expression' || fn.type === 'anonymous_method_expression' || fn.type === 'local_function_statement')) fn = enclosingFunction(fn);
        if (!fn || fn.type !== 'method_declaration') continue;
        if (cfg.publicOnly !== false && !hasModifier(fn, 'public')) { ctx.debugSkip(m.call, 'method not public'); continue; }
        const alt = hit.async;
        const args = m.call.childForFieldName('arguments')?.text || '()';
        const rewrite = hit.call ? `await ${alt}${args}` : (alt.includes('.') ? `await ${alt}(...)` : `await ${m.receiver.text}.${alt}${args}`);
        ctx.report(m.call, 'R2.syncIo', { method: nameOf(fn), call: callee, alt }, rewrite);
      }
    }
  },
};
