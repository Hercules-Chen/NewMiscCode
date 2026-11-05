// OpenAPI 3.x 差異比對與分類。 OpenAPI 3.x diff + classification.
import { makeFinding, SEVERITIES } from './rules.js';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const MAX_DEPTH = 30;

/** 路徑樣板正規化：/orders/{id} 與 /orders/{orderId} 視為同一路徑。 */
export const normPath = p => p.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '') || '/';
const paramKey = p => `${p.in}:${p.in === 'header' ? String(p.name).toLowerCase() : p.name}`;
const looseName = n => String(n).toLowerCase().replace(/^x-/, '').replace(/[-_]/g, '');

function mergeAllOf(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.allOf)) return s;
  const out = { ...s };
  delete out.allOf;
  out.properties = { ...(s.properties || {}) };
  out.required = [...(s.required || [])];
  for (const part0 of s.allOf) {
    const part = mergeAllOf(part0) || {};
    Object.assign(out.properties, part.properties || {});
    out.required.push(...(part.required || []));
    for (const k of ['type', 'format', 'enum', 'items', 'nullable']) if (part[k] !== undefined && out[k] === undefined) out[k] = part[k];
  }
  if (!Object.keys(out.properties).length) delete out.properties;
  return out;
}

export function typesOf(s) {
  if (!s || typeof s !== 'object') return ['any'];
  let t;
  if (Array.isArray(s.type)) t = [...s.type];
  else if (typeof s.type === 'string') t = [s.type];
  else if (s.properties) t = ['object'];
  else if (s.items) t = ['array'];
  else t = ['any'];
  if (s.nullable === true && !t.includes('null')) t.push('null');
  return t;
}
const nonNull = t => t.filter(x => x !== 'null');
function subsetOf(a, b) {
  if (b.includes('any')) return true;
  return a.every(x => b.includes(x) || (x === 'integer' && b.includes('number')));
}

function compareSchema(o0, n0, ctx, field, out, depth = 0) {
  if (!o0 || !n0 || depth > MAX_DEPTH) return;
  if (o0['x-circular-ref'] || n0['x-circular-ref']) return;
  const o = mergeAllOf(o0), n = mergeAllOf(n0);
  const { dir, loc } = ctx;
  const label = field || '(body)';
  const ot = typesOf(o), nt = typesOf(n);
  const otn = nonNull(ot), ntn = nonNull(nt);
  let typeBroken = false;
  if (dir === 'response') {
    if (!subsetOf(ntn, otn)) { out.push(makeFinding('RESPONSE_TYPE_CHANGED', loc, { field: label, old: otn.join('|'), new: ntn.join('|') }, { field: label })); typeBroken = true; }
    if (nt.includes('null') && !ot.includes('null')) out.push(makeFinding('RESPONSE_BECAME_NULLABLE', loc, { field: label }, { field: label }));
  } else if (!subsetOf(otn, ntn)) {
    out.push(makeFinding('REQUEST_TYPE_CHANGED', loc, { field: label, old: otn.join('|'), new: ntn.join('|') }, { field: label }));
    typeBroken = true;
  }
  if (typeBroken) return; // 型別都變了，子欄位比較沒有意義
  if (o.format && n.format && o.format !== n.format) out.push(makeFinding('FORMAT_CHANGED', loc, { field: label, old: o.format, new: n.format }, { field: label }));

  if (Array.isArray(o.enum) || Array.isArray(n.enum)) {
    const os = new Set((o.enum || []).map(v => JSON.stringify(v)));
    const ns = new Set((n.enum || []).map(v => JSON.stringify(v)));
    if (Array.isArray(o.enum) && Array.isArray(n.enum)) {
      for (const v of os) if (!ns.has(v)) out.push(makeFinding(dir === 'response' ? 'RESPONSE_ENUM_VALUE_REMOVED' : 'REQUEST_ENUM_VALUE_REMOVED', loc, { field: label, value: v }, { field: label }));
      for (const v of ns) if (!os.has(v)) out.push(makeFinding(dir === 'response' ? 'RESPONSE_ENUM_VALUE_ADDED' : 'REQUEST_ENUM_VALUE_ADDED', loc, { field: label, value: v }, { field: label }));
    } else if (!Array.isArray(o.enum) && Array.isArray(n.enum) && dir === 'request') {
      out.push(makeFinding('REQUEST_CONSTRAINT_TIGHTENED', loc, { field: label, detail: `enum ${[...ns].join(',')}` }, { field: label }));
    }
  }

  if (dir === 'request') {
    const tight = [];
    const lower = (k) => n[k] !== undefined && (o[k] === undefined || n[k] < o[k]);
    const higher = (k) => n[k] !== undefined && (o[k] === undefined || n[k] > o[k]);
    for (const k of ['maxLength', 'maximum', 'maxItems']) if (lower(k)) tight.push(`${k} ${o[k] ?? '-'} -> ${n[k]}`);
    for (const k of ['minLength', 'minimum', 'minItems']) if (higher(k)) tight.push(`${k} ${o[k] ?? '-'} -> ${n[k]}`);
    if (n.pattern && n.pattern !== o.pattern) tight.push(`pattern ${o.pattern ?? '-'} -> ${n.pattern}`);
    if (tight.length) out.push(makeFinding('REQUEST_CONSTRAINT_TIGHTENED', loc, { field: label, detail: tight.join('; ') }, { field: label }));
  }

  if (o.properties || n.properties) {
    const op = o.properties || {}, np = n.properties || {};
    const oreq = new Set(o.required || []), nreq = new Set(n.required || []);
    const sub = k => (field ? `${field}.${k}` : k);
    for (const k of Object.keys(op)) {
      if (!(k in np)) {
        out.push(makeFinding(dir === 'response' ? 'RESPONSE_FIELD_REMOVED' : 'REQUEST_FIELD_REMOVED', loc, { field: sub(k) }, { field: sub(k) }));
        continue;
      }
      if (dir === 'response') {
        if (oreq.has(k) && !nreq.has(k)) out.push(makeFinding('RESPONSE_REQUIRED_TO_OPTIONAL', loc, { field: sub(k) }, { field: sub(k) }));
        if (!oreq.has(k) && nreq.has(k)) out.push(makeFinding('RESPONSE_OPTIONAL_TO_REQUIRED', loc, { field: sub(k) }, { field: sub(k) }));
      } else if (!oreq.has(k) && nreq.has(k)) {
        out.push(makeFinding('REQUEST_FIELD_BECAME_REQUIRED', loc, { field: sub(k) }, { field: sub(k) }));
      }
      compareSchema(op[k], np[k], ctx, sub(k), out, depth + 1);
    }
    for (const k of Object.keys(np)) {
      if (k in op) continue;
      if (dir === 'response') out.push(makeFinding('RESPONSE_FIELD_ADDED', loc, { field: sub(k) }, { field: sub(k) }));
      else out.push(makeFinding(nreq.has(k) ? 'REQUEST_FIELD_ADDED_REQUIRED' : 'REQUEST_FIELD_ADDED_OPTIONAL', loc, { field: sub(k) }, { field: sub(k) }));
    }
  }
  if (o.items || n.items) compareSchema(o.items || {}, n.items || {}, ctx, `${field || ''}[]`, out, depth + 1);
}

function collectParams(pathItem, op) {
  const m = new Map();
  for (const p of [...(pathItem.parameters || []), ...(op.parameters || [])]) if (p && p.name && p.in) m.set(paramKey(p), p);
  return m;
}

function compareParams(oldOp, newOp, oldItem, newItem, loc, out) {
  const op = collectParams(oldItem, oldOp), np = collectParams(newItem, newOp);
  const removed = [...op.keys()].filter(k => !np.has(k));
  const added = new Set([...np.keys()].filter(k => !op.has(k)));
  for (const k of removed) {
    const p = op.get(k);
    if (p.in === 'path') continue; // 路徑參數改名由路徑比對處理
    const moved = [...added].map(a => np.get(a)).find(q => looseName(q.name) === looseName(p.name) && q.in !== p.in);
    if (moved) {
      added.delete(paramKey(moved));
      out.push(makeFinding('PARAM_LOCATION_CHANGED', loc, { param: p.name, old: `${p.in}:${p.name}`, new: `${moved.in}:${moved.name}` }, { field: p.name }));
    } else {
      out.push(makeFinding('PARAM_REMOVED', loc, { param: p.name, in: p.in }, { field: p.name }));
    }
  }
  for (const k of added) {
    const p = np.get(k);
    if (p.in === 'path') continue;
    out.push(makeFinding(p.required ? 'PARAM_ADDED_REQUIRED' : 'PARAM_ADDED_OPTIONAL', loc, { param: p.name, in: p.in }, { field: p.name }));
  }
  for (const [k, o] of op) {
    const n = np.get(k);
    if (!n) continue;
    if (!o.required && n.required) out.push(makeFinding('PARAM_BECAME_REQUIRED', loc, { param: o.name, in: o.in }, { field: o.name }));
    if (o.required && !n.required && o.in !== 'path') out.push(makeFinding('PARAM_BECAME_OPTIONAL', loc, { param: o.name, in: o.in }, { field: o.name }));
    compareSchema(o.schema, n.schema, { dir: 'request', loc }, `${o.in}:${o.name}`, out);
  }
}

const mediaBase = m => String(m).split(';')[0].trim().toLowerCase();
function contentMap(c) { const m = new Map(); for (const [k, v] of Object.entries(c || {})) m.set(mediaBase(k), v || {}); return m; }

function compareRequestBody(o, n, loc, out) {
  if (!o && !n) return;
  if (n && n.required && !(o && o.required)) out.push(makeFinding('REQUEST_BODY_BECAME_REQUIRED', loc, {}));
  if (!o || !n) return;
  const oc = contentMap(o.content), nc = contentMap(n.content);
  for (const [m, ov] of oc) {
    if (!nc.has(m)) { out.push(makeFinding('REQUEST_MEDIA_TYPE_REMOVED', loc, { media: m })); continue; }
    compareSchema(ov.schema, nc.get(m).schema, { dir: 'request', loc }, '', out);
  }
}

function compareResponses(o = {}, n = {}, loc, out) {
  for (const [status, ov] of Object.entries(o)) {
    const nv = n[status];
    if (!nv) {
      out.push(makeFinding(/^2/.test(status) ? 'RESPONSE_STATUS_REMOVED' : 'RESPONSE_STATUS_REMOVED_ERROR', loc, { status }));
      continue;
    }
    const sloc = `${loc} -> ${status}`;
    for (const h of Object.keys(ov.headers || {})) {
      if (!Object.keys(nv.headers || {}).some(x => x.toLowerCase() === h.toLowerCase())) out.push(makeFinding('RESPONSE_HEADER_REMOVED', sloc, { header: h }, { field: h }));
    }
    const oc = contentMap(ov.content), nc = contentMap(nv.content);
    for (const [m, omv] of oc) {
      if (!nc.has(m)) { out.push(makeFinding('RESPONSE_MEDIA_TYPE_REMOVED', sloc, { status, media: m })); continue; }
      compareSchema(omv.schema, nc.get(m).schema, { dir: 'response', loc: sloc }, '', out);
    }
  }
  for (const status of Object.keys(n)) if (!o[status]) out.push(makeFinding('RESPONSE_STATUS_ADDED', loc, { status }));
}

const isOpen = sec => !sec || sec.length === 0 || sec.some(s => s && Object.keys(s).length === 0);

/** 比對兩份已解析 $ref 的 OpenAPI 文件。 Compare two dereferenced OpenAPI docs. */
export function diffSpecs(oldDoc, newDoc) {
  const out = [];
  const oPaths = oldDoc.paths || {}, nPaths = newDoc.paths || {};
  const nIndex = new Map(Object.keys(nPaths).map(p => [normPath(p), p]));
  const oIndex = new Map(Object.keys(oPaths).map(p => [normPath(p), p]));
  for (const [norm, oKey] of oIndex) {
    const oItem = oPaths[oKey] || {};
    const nKey = nIndex.get(norm);
    if (!nKey) { out.push(makeFinding('PATH_REMOVED', oKey, { path: oKey })); continue; }
    const nItem = nPaths[nKey] || {};
    for (const m of METHODS) {
      const oOp = oItem[m], nOp = nItem[m];
      const loc = `${m.toUpperCase()} ${nKey}`;
      if (oOp && !nOp) { out.push(makeFinding('OPERATION_REMOVED', loc, { op: `${m.toUpperCase()} ${oKey}` })); continue; }
      if (!oOp && nOp) { out.push(makeFinding('OPERATION_ADDED', loc, { op: loc })); continue; }
      if (!oOp) continue;
      if (nOp.deprecated && !oOp.deprecated) out.push(makeFinding('OPERATION_DEPRECATED', loc, { op: loc }));
      if (oOp.operationId && nOp.operationId && oOp.operationId !== nOp.operationId) out.push(makeFinding('OPERATION_ID_CHANGED', loc, { old: oOp.operationId, new: nOp.operationId }));
      const oSec = oOp.security ?? oldDoc.security, nSec = nOp.security ?? newDoc.security;
      if (isOpen(oSec) && !isOpen(nSec)) out.push(makeFinding('SECURITY_ADDED', loc, { op: loc }));
      compareParams(oOp, nOp, oItem, nItem, loc, out);
      compareRequestBody(oOp.requestBody, nOp.requestBody, loc, out);
      compareResponses(oOp.responses, nOp.responses, loc, out);
    }
  }
  for (const [norm, nKey] of nIndex) if (!oIndex.has(norm)) out.push(makeFinding('PATH_ADDED', nKey, { path: nKey }));
  const rank = s => SEVERITIES.indexOf(s);
  out.sort((a, b) => rank(a.severity) - rank(b.severity) || a.location.localeCompare(b.location) || a.rule.localeCompare(b.rule));
  return out;
}

export function summarize(findings) {
  const s = { BREAKING: 0, NON_BREAKING: 0, INFO: 0 };
  for (const f of findings) s[f.severity]++;
  return s;
}
