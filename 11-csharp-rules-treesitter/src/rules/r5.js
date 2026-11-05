// R5: catch blocks that neither log nor rethrow.
import { compact } from './util.js';

export default {
  id: 'R5',
  queries: ['R5-swallowed-catch', 'R5-handled'],
  check(ctx) {
    const cfg = ctx.cfg;
    const logRx = (cfg.loggingPatterns || []).map(p => new RegExp(p));
    const ignore = new Set(cfg.ignoreExceptionTypes || []);
    for (const m of ctx.matches('R5-swallowed-catch')) {
      const typeText = m.type ? compact(m.type.text) : '';
      const shortType = typeText.split('.').pop();
      if (ignore.has(shortType)) { ctx.debugSkip(m.catch, `ignored exception type ${shortType}`); continue; }
      let handled = null;
      for (const h of ctx.matches('R5-handled', m.body)) {
        if (h.throw) { handled = 'rethrow'; break; }
        if (h.callee) {
          const callee = compact(h.callee.text).replace(/<.*>$/, '');
          if (logRx.some(rx => rx.test(callee))) { handled = 'log:' + callee; break; }
        }
      }
      if (handled) { ctx.debugSkip(m.catch, `handled (${handled})`); continue; }
      const decl = m.catch.namedChildren.find(c => c.type === 'catch_declaration');
      const varName = decl?.childForFieldName('name')?.text || 'ex';
      const t = typeText || 'Exception';
      ctx.report(m.catch, 'R5.swallow', { type: typeText || '*' },
        `catch (${t} ${varName})\n{\n    _logger.LogError(${varName}, "...");\n    throw; // or handle explicitly\n}`);
    }
  },
};
