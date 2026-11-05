// Minimal glob -> RegExp (supports **, *, ?, {a,b}). Paths are matched in POSIX form.
const cache = new Map();

export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let re = '';
  let i = 0;
  const g = glob.replace(/\\/g, '/');
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // "**/" matches zero or more directories; trailing "**" matches everything
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue; }
        re += '.*'; i += 2; continue;
      }
      re += '[^/]*'; i++; continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '{') {
      const end = g.indexOf('}', i);
      if (end > i) { re += '(?:' + g.slice(i + 1, end).split(',').map(escape).join('|') + ')'; i = end + 1; continue; }
    }
    re += escape(c); i++;
  }
  const rx = new RegExp('^' + re + '$', 'i');
  cache.set(glob, rx);
  return rx;
}

function escape(s) { return s.replace(/[.+^${}()|[\]\\]/g, '\\$&'); }

export function toPosix(p) { return p.replace(/\\/g, '/'); }

/** True when the posix path matches any glob. Globs without "/" also match the basename. */
export function matchAny(posixPath, globs = []) {
  const base = posixPath.split('/').pop();
  for (const g of globs) {
    const rx = globToRegExp(g);
    if (rx.test(posixPath)) return g;
    if (!g.includes('/') && rx.test(base)) return g;
  }
  return null;
}

/** Simple name pattern (e.g. "*Tests", "Startup") -> boolean. */
export function matchName(name, patterns = []) {
  return patterns.some(p => globToRegExp(p).test(name));
}
