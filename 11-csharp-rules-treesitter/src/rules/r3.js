// R3: fewer out parameters — suggest a tuple return instead.
import { hasModifier } from './util.js';

export default {
  id: 'R3',
  queries: ['R3-out-params'],
  check(ctx) {
    const cfg = ctx.cfg;
    const byMethod = new Map();
    for (const m of ctx.matches('R3-out-params')) {
      const e = byMethod.get(m.method.id) || { m, params: [] };
      e.params.push(m.param.parent);
      byMethod.set(m.method.id, e);
    }
    for (const { m, params } of byMethod.values()) {
      const name = m.name.text;
      if (cfg.ignoreTryPattern !== false && /^Try[A-Z_]/.test(name)) { ctx.debugSkip(m.method, 'Try* pattern'); continue; }
      if (cfg.ignoreDeconstruct !== false && name === 'Deconstruct') { ctx.debugSkip(m.method, 'Deconstruct'); continue; }
      if (cfg.ignoreOverrides !== false && hasModifier(m.method, 'override')) { ctx.debugSkip(m.method, 'override'); continue; }
      if (cfg.ignoreExtern !== false && hasModifier(m.method, 'extern')) { ctx.debugSkip(m.method, 'extern'); continue; }
      const outs = params.map(p => ({ type: p.childForFieldName('type')?.text || 'var', name: p.childForFieldName('name')?.text }));
      const ret = (m.method.childForFieldName('returns') || m.method.childForFieldName('type'))?.text || 'void';
      const elems = [...(ret === 'void' ? [] : [`${ret} Result`]), ...outs.map(o => `${o.type} ${cap(o.name)}`)];
      const tuple = elems.length === 1 ? elems[0].split(' ')[0] : `(${elems.join(', ')})`;
      const plist = m.method.childForFieldName('parameters');
      const kept = plist.namedChildren.filter(p => p.type === 'parameter' && !params.some(q => q.id === p.id)).map(p => p.text);
      const suggestion = `${tuple} ${name}(${kept.join(', ')})`;
      ctx.report(m.name, 'R3.out', { name, params: outs.map(o => 'out ' + o.type + ' ' + o.name).join(', ') }, suggestion);
    }
  },
};
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
