// 載入 OpenAPI 3.x（JSON / YAML）並解析 $ref。 Load OpenAPI 3.x (JSON/YAML) and resolve $ref.
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import YAML from 'yaml';

export function parseText(text, hint = '') {
  const t = text.replace(/^﻿/, '');
  if (/\.json$/i.test(hint) || /^\s*[{[]/.test(t)) {
    try { return JSON.parse(t); } catch (e) { if (/\.json$/i.test(hint)) throw e; }
  }
  return YAML.parse(t, { maxAliasCount: 1000 });
}

function pointerGet(doc, pointer, ref) {
  if (!pointer || pointer === '/') return doc;
  const parts = pointer.replace(/^\//, '').split('/').map(p => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = doc;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in cur)) throw new Error(`$ref not found: ${ref}`);
    cur = cur[p];
  }
  return cur;
}

/**
 * 解析所有 $ref（同檔 #/components/... 與相對檔案 other.yaml#/x）。
 * 循環參照會以 { 'x-circular-ref': ref } 取代，避免無限遞迴。
 * Resolves internal and relative-file $refs; cycles become { 'x-circular-ref': ref }.
 */
export async function dereference(doc, { baseFile = null, maxDepth = 64 } = {}) {
  const files = new Map(); // abs path -> parsed doc
  if (baseFile) files.set(baseFile, doc);
  const refsSeen = new Set();

  async function loadFile(abs) {
    if (!files.has(abs)) files.set(abs, parseText(await readFile(abs, 'utf8'), abs));
    return files.get(abs);
  }

  async function walk(node, curFile, curDoc, stack) {
    if (Array.isArray(node)) {
      const out = [];
      for (const x of node) out.push(await walk(x, curFile, curDoc, stack));
      return out;
    }
    if (node === null || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      const [filePart, ptr = ''] = ref.split('#');
      let targetFile = curFile, targetDoc = curDoc;
      if (filePart) {
        if (!curFile) throw new Error(`external $ref needs a base file: ${ref}`);
        targetFile = resolve(dirname(curFile), filePart);
        targetDoc = await loadFile(targetFile);
      }
      const key = `${targetFile || ''}#${ptr}`;
      refsSeen.add(ref);
      if (stack.includes(key) || stack.length > maxDepth) return { 'x-circular-ref': ref };
      const target = pointerGet(targetDoc, ptr, ref);
      const resolved = await walk(target, targetFile, targetDoc, [...stack, key]);
      // 兄弟欄位（3.1 允許 description 等）合併。 Merge sibling keys (allowed in 3.1).
      const siblings = Object.keys(node).filter(k => k !== '$ref');
      if (siblings.length && resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
        const extra = {};
        for (const k of siblings) extra[k] = await walk(node[k], curFile, curDoc, stack);
        return { ...resolved, ...extra, 'x-ref': ref };
      }
      return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? { ...resolved, 'x-ref': ref } : resolved;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = await walk(v, curFile, curDoc, stack);
    return out;
  }

  const result = await walk(doc, baseFile, doc, []);
  return { doc: result, refs: [...refsSeen] };
}

export async function loadSpec(file) {
  const abs = resolve(file);
  const text = await readFile(abs, 'utf8');
  const raw = parseText(text, extname(abs));
  if (!raw || typeof raw !== 'object') throw new Error(`not an object: ${file}`);
  const version = String(raw.openapi || '');
  if (!/^3\./.test(version)) {
    const e = new Error(raw.swagger ? `Swagger 2.0 is not supported (${file}); convert to OpenAPI 3.x first` : `missing "openapi: 3.x" in ${file}`);
    e.code = 'E_SPEC_VERSION';
    throw e;
  }
  const { doc, refs } = await dereference(raw, { baseFile: abs });
  return { file: abs, version, doc, refs };
}
