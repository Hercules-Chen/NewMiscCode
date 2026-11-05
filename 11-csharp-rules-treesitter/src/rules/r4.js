// R4: new HttpClient() inside methods; Thread.Sleep inside async code.
import { closest, enclosingFunction, hasModifier, nameOf } from './util.js';

const METHOD_LIKE = new Set(['method_declaration', 'local_function_statement', 'lambda_expression', 'anonymous_method_expression', 'accessor_declaration']);

export default {
  id: 'R4',
  queries: ['R4-resource-misuse'],
  check(ctx) {
    const cfg = ctx.cfg;
    for (const m of ctx.matches('R4-resource-misuse')) {
      if (m.new_http && cfg.httpClient !== false) {
        // Field/static initialisers and constructors are fine (shared instance); flag creation inside method bodies.
        const fn = enclosingFunction(m.new_http);
        if (!fn || !METHOD_LIKE.has(fn.type)) { ctx.debugSkip(m.new_http, 'not inside a method body'); continue; }
        ctx.report(m.new_http, 'R4.httpClient', {}, '// inject IHttpClientFactory:\nvar client = _httpClientFactory.CreateClient("name");\n// or reuse: private static readonly HttpClient s_http = new HttpClient();');
      } else if (m.sleep && cfg.threadSleep !== false) {
        const fn = enclosingFunction(m.sleep);
        if (!fn || !hasModifier(fn, 'async')) { ctx.debugSkip(m.sleep, 'enclosing function is not async'); continue; }
        const arg = m.sleep.childForFieldName('arguments')?.text || '(...)';
        const owner = fn.type === 'lambda_expression' ? (nameOf(closest(fn, new Set(['method_declaration']))) + ' (lambda)') : nameOf(fn);
        ctx.report(m.sleep, 'R4.threadSleep', { name: owner }, `await Task.Delay${arg};`);
      }
    }
  },
};
