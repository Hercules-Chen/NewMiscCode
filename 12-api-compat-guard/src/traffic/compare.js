// 回應結構比對（錄製的舊回應 vs 新服務回應）。 Structural response comparison.
import { compileAll, anyMatch, toPathString } from './jsonpath.js';
import { fmt } from '../openapi/rules.js';

export const REPLAY_RULES = {
  STATUS_CHANGED: { severity: 'BREAKING', zh: '狀態碼由 {old} 變成 {new}', en: 'Status changed {old} -> {new}' },
  REQUEST_FAILED: { severity: 'BREAKING', zh: '無法呼叫新服務：{detail}', en: 'Request to new service failed: {detail}' },
  HEADER_MISSING: { severity: 'BREAKING', zh: '缺少回應標頭 {field}', en: 'Response header {field} missing' },
  HEADER_CHANGED: { severity: 'BREAKING', zh: '回應標頭 {field} 由 {old} 變成 {new}', en: 'Response header {field} changed {old} -> {new}' },
  BODY_KIND_CHANGED: { severity: 'BREAKING', zh: '回應本文格式由 {old} 變成 {new}', en: 'Body kind changed {old} -> {new}' },
  FIELD_MISSING: { severity: 'BREAKING', zh: '欄位 {field} 在新回應中消失', en: 'Field {field} missing in new response' },
  FIELD_ADDED: { severity: 'NON_BREAKING', zh: '新回應多了欄位 {field}', en: 'Field {field} added in new response' },
  TYPE_CHANGED: { severity: 'BREAKING', zh: '欄位 {field} 型別由 {old} 變成 {new}', en: 'Field {field} type changed {old} -> {new}' },
  NULL_TO_VALUE: { severity: 'INFO', zh: '欄位 {field} 由 null 變成有值（{new}）', en: 'Field {field} was null, now {new}' },
  VALUE_CHANGED: { severity: 'BREAKING', zh: '欄位 {field} 值由 {old} 變成 {new}', en: 'Field {field} value changed {old} -> {new}' },
  ARRAY_LENGTH_CHANGED: { severity: 'BREAKING', zh: '陣列 {field} 長度由 {old} 變成 {new}', en: 'Array {field} length changed {old} -> {new}' }
};

export const DEFAULT_REPLAY = {
  headers: ['content-type'],
  compareValues: true,
  arrayOrder: 'strict',
  ignoreTimestamps: true,
  ignoreUuids: true,
  ignorePaths: [],
  skipPaths: [],
  statusClassMismatchSkipsBody: true,
  rules: []
};

const ISO_TS = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const jsonType = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const short = v => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 60 ? s.slice(0, 57) + '...' : s; };

function globToRx(glob) {
  const esc = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

/** 依 method + path 合併個別規則。 Merge per-endpoint rules matching "METHOD /path/*". */
export function effectiveOptions(base, method, url) {
  const opt = { ...DEFAULT_REPLAY, ...(base || {}) };
  const path = String(url).split('?')[0];
  let ignore = [...(opt.ignorePaths || [])], skip = [...(opt.skipPaths || [])];
  for (const r of opt.rules || []) {
    const [m, p] = String(r.match || '').includes(' ') ? r.match.split(/\s+/, 2) : ['*', r.match || '**'];
    if ((m === '*' || m.toUpperCase() === method.toUpperCase()) && globToRx(p).test(path)) {
      Object.assign(opt, Object.fromEntries(Object.entries(r).filter(([k]) => !['match', 'ignorePaths', 'skipPaths'].includes(k))));
      ignore.push(...(r.ignorePaths || []));
      skip.push(...(r.skipPaths || []));
    }
  }
  opt._ignore = compileAll(ignore);
  opt._skip = compileAll(skip);
  return opt;
}

function mk(kind, tokens, params, extra = {}) {
  const r = REPLAY_RULES[kind];
  const field = Array.isArray(tokens) ? toPathString(tokens) : tokens;
  const p = { field, ...params };
  return { rule: kind, severity: r.severity, field, message: { 'zh-TW': fmt(r.zh, p), en: fmt(r.en, p) }, params: p, ...extra };
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',')}}`;
  return JSON.stringify(v);
}

function sameValue(a, b, opt) {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    if (opt.ignoreTimestamps && ISO_TS.test(a) && ISO_TS.test(b)) return true;
    if (opt.ignoreUuids && UUID.test(a) && UUID.test(b)) return true;
  }
  return false;
}

export function compareJson(a, b, opt, tokens = [], out = []) {
  if (tokens.length && anyMatch(opt._skip, tokens)) return out;
  const ta = jsonType(a), tb = jsonType(b);
  if (ta !== tb) {
    if (ta === 'null') out.push(mk('NULL_TO_VALUE', tokens, { old: 'null', new: short(b) }));
    else out.push(mk('TYPE_CHANGED', tokens, { old: ta, new: tb }, { oldValue: short(a), newValue: short(b) }));
    return out;
  }
  const valuesIgnored = tokens.length && anyMatch(opt._ignore, tokens);
  if (ta === 'object') {
    for (const k of Object.keys(a)) {
      const sub = [...tokens, k];
      if (anyMatch(opt._skip, sub)) continue;
      if (!(k in b)) out.push(mk('FIELD_MISSING', sub, {}, { oldValue: short(a[k]) }));
      else compareJson(a[k], b[k], opt, sub, out);
    }
    for (const k of Object.keys(b)) {
      const sub = [...tokens, k];
      if (!(k in a) && !anyMatch(opt._skip, sub)) out.push(mk('FIELD_ADDED', sub, {}, { newValue: short(b[k]) }));
    }
    return out;
  }
  if (ta === 'array') {
    let xa = a, xb = b;
    if (opt.arrayOrder === 'ignore') {
      xa = [...a].sort((p, q) => canonical(p).localeCompare(canonical(q)));
      xb = [...b].sort((p, q) => canonical(p).localeCompare(canonical(q)));
    }
    if (xa.length !== xb.length && opt.compareValues && !valuesIgnored) out.push(mk('ARRAY_LENGTH_CHANGED', tokens, { old: xa.length, new: xb.length }));
    const n = Math.min(xa.length, xb.length);
    for (let i = 0; i < n; i++) compareJson(xa[i], xb[i], opt, [...tokens, i], out);
    return out;
  }
  if (opt.compareValues && !valuesIgnored && !sameValue(a, b, opt)) out.push(mk('VALUE_CHANGED', tokens, { old: short(a), new: short(b) }));
  return out;
}

const mediaBase = v => String(v || '').split(';')[0].trim().toLowerCase();

/** 比對一筆錄製回應與新回應。 Compare a recorded response with the new one. */
export function compareExchange(recorded, actual, options) {
  const out = [];
  if (recorded.status !== actual.status) out.push(mk('STATUS_CHANGED', 'status', { old: recorded.status, new: actual.status }));
  const lower = h => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const rh = lower(recorded.headers), ah = lower(actual.headers);
  for (const h0 of options.headers || []) {
    const h = h0.toLowerCase();
    if (rh[h] === undefined) continue;
    if (ah[h] === undefined) { out.push(mk('HEADER_MISSING', `header:${h}`, {})); continue; }
    const norm = h === 'content-type' ? mediaBase : v => String(v);
    if (norm(rh[h]) !== norm(ah[h])) out.push(mk('HEADER_CHANGED', `header:${h}`, { old: norm(rh[h]), new: norm(ah[h]) }));
  }
  const rb = recorded.body || { kind: 'empty' }, ab = actual.body || { kind: 'empty' };
  // 成功變失敗（2xx -> 4xx）時本文本來就不同，只報狀態碼以免雜訊。 Skip body noise when status class differs.
  if (options.statusClassMismatchSkipsBody && Math.floor(recorded.status / 100) !== Math.floor(actual.status / 100)) return out;
  if (rb.kind !== ab.kind) {
    out.push(mk('BODY_KIND_CHANGED', 'body', { old: rb.kind, new: ab.kind }));
  } else if (rb.kind === 'json') {
    compareJson(rb.value, ab.value, options, [], out);
  } else if (rb.kind !== 'empty' && options.compareValues && rb.value !== ab.value) {
    out.push(mk('VALUE_CHANGED', 'body', { old: short(rb.value), new: short(ab.value) }));
  }
  return out;
}
