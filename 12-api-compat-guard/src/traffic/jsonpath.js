// 迷你 JSONPath（只支援遮罩與忽略規則需要的子集）。
// Tiny JSONPath subset: $.a.b  $.items[*].x  $.items[0]  $..password  $.*
// 比對對象是「具體路徑」tokens（字串 key 或數字 index）。

export function compile(path) {
  const src = String(path).trim();
  if (!src.startsWith('$')) throw new Error(`JSONPath must start with $: ${path}`);
  const toks = [];
  let i = 1;
  while (i < src.length) {
    if (src.startsWith('..', i)) {
      i += 2;
      const m = /^([A-Za-z0-9_\-$@]+|\*)/.exec(src.slice(i));
      if (!m) throw new Error(`bad JSONPath: ${path}`);
      toks.push({ t: 'desc', k: m[1] });
      i += m[1].length;
    } else if (src[i] === '.') {
      i += 1;
      const m = /^([A-Za-z0-9_\-$@]+|\*)/.exec(src.slice(i));
      if (!m) throw new Error(`bad JSONPath: ${path}`);
      toks.push(m[1] === '*' ? { t: 'any' } : { t: 'key', k: m[1] });
      i += m[1].length;
    } else if (src[i] === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new Error(`bad JSONPath: ${path}`);
      const inner = src.slice(i + 1, end).trim();
      if (inner === '*') toks.push({ t: 'any' });
      else if (/^\d+$/.test(inner)) toks.push({ t: 'idx', i: Number(inner) });
      else toks.push({ t: 'key', k: inner.replace(/^['"]|['"]$/g, '') });
      i = end + 1;
    } else throw new Error(`bad JSONPath: ${path}`);
  }
  return toks;
}

function matchFrom(pt, pi, ct, ci) {
  if (pi === pt.length) return ci === ct.length;
  const p = pt[pi];
  if (p.t === 'desc') {
    for (let j = ci; j < ct.length; j++) {
      if ((p.k === '*' || ct[j] === p.k) && matchFrom(pt, pi + 1, ct, j + 1)) return true;
    }
    return false;
  }
  if (ci >= ct.length) return false;
  const c = ct[ci];
  if (p.t === 'any') return matchFrom(pt, pi + 1, ct, ci + 1);
  if (p.t === 'idx') return c === p.i && matchFrom(pt, pi + 1, ct, ci + 1);
  return c === p.k && matchFrom(pt, pi + 1, ct, ci + 1);
}

export function matches(compiled, concrete) { return matchFrom(compiled, 0, concrete, 0); }

export function compileAll(paths = []) { return paths.map(p => ({ src: p, toks: compile(p) })); }
export function anyMatch(compiledList, concrete) { return compiledList.some(c => matches(c.toks, concrete)); }

export function toPathString(tokens) {
  let s = '$';
  for (const t of tokens) s += typeof t === 'number' ? `[${t}]` : (/^[A-Za-z_$][\w$-]*$/.test(t) ? `.${t}` : `['${t}']`);
  return s;
}
