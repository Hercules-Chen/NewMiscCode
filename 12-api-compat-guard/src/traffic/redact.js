// 遮罩：在寫入錄製檔「之前」移除秘密。 Redaction BEFORE anything is written to disk.
import { compileAll, anyMatch } from './jsonpath.js';

export const REDACTED = '***REDACTED***';
export const DEFAULT_REDACT = {
  headers: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'],
  query: ['access_token', 'api_key', 'apikey', 'token', 'password'],
  jsonPaths: ['$..password', '$..token', '$..accessToken', '$..refreshToken', '$..secret']
};

export function makeRedactor(cfg = {}) {
  const headers = new Set([...(cfg.headers ?? DEFAULT_REDACT.headers)].map(h => h.toLowerCase()));
  const query = new Set([...(cfg.query ?? DEFAULT_REDACT.query)].map(q => q.toLowerCase()));
  const paths = compileAll(cfg.jsonPaths ?? DEFAULT_REDACT.jsonPaths);

  function redactHeaders(h = {}) {
    const out = {};
    for (const [k, v] of Object.entries(h)) out[k] = headers.has(k.toLowerCase()) ? REDACTED : v;
    return out;
  }
  function redactUrl(url) {
    const q = url.indexOf('?');
    if (q < 0) return url;
    const sp = new URLSearchParams(url.slice(q + 1));
    let changed = false;
    for (const k of [...sp.keys()]) if (query.has(k.toLowerCase())) { sp.set(k, REDACTED); changed = true; }
    return changed ? `${url.slice(0, q)}?${sp.toString()}` : url;
  }
  function redactJson(value) {
    const walk = (v, tokens) => {
      if (tokens.length && anyMatch(paths, tokens)) return REDACTED;
      if (Array.isArray(v)) return v.map((x, i) => walk(x, [...tokens, i]));
      if (v && typeof v === 'object') {
        const o = {};
        for (const [k, x] of Object.entries(v)) o[k] = walk(x, [...tokens, k]);
        return o;
      }
      return v;
    };
    return walk(value, []);
  }
  return { redactHeaders, redactUrl, redactJson };
}
