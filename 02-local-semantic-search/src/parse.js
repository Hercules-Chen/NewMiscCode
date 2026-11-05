// Markdown / HTML parsing and heading-aware chunking (dependency-free).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Convert HTML into a markdown-ish text so one heading-aware chunker handles both. */
export function htmlToMarkdownish(html) {
  let s = String(html);
  const titleM = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, '')).trim() : '';
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => `\n\n${'#'.repeat(Number(n))} ${inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|section|article|pre|blockquote|table|ul|ol|dd|dt)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/[ \t ]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return { title, body: s.trim() };
}

/** Strip YAML front matter; return { meta, body }. Only simple `key: value` lines are read. */
export function stripFrontMatter(md) {
  const m = String(md).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: String(md).replace(/^﻿/, '') };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: String(md).slice(m[0].length) };
}

/** Light markdown cleanup for indexing (keeps text, drops syntax noise). */
export function cleanMarkdownInline(s) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')            // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')             // links
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')       // [[target|alias]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                  // [[wikilink]]
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '');
}

/**
 * Split markdown into sections by ATX headings (ignores '#' inside fenced code).
 * Returns [{ headingPath: string[], level, text, line }]
 */
export function splitSections(md, docTitle = '') {
  const lines = String(md).split(/\r?\n/);
  const sections = [];
  const stack = [];
  let cur = { headingPath: docTitle ? [docTitle] : [], level: 0, lines: [], line: 1 };
  let inFence = false;
  const flush = () => {
    const text = cur.lines.join('\n').trim();
    if (text) sections.push({ headingPath: cur.headingPath, level: cur.level, text, line: cur.line });
  };
  lines.forEach((raw, idx) => {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    const h = !inFence && raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      const level = h[1].length;
      const title = cleanMarkdownInline(h[2]).trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      const path = stack.map((x) => x.title);
      if (docTitle && path[0] !== docTitle) path.unshift(docTitle);
      cur = { headingPath: path, level, lines: [], line: idx + 1 };
    } else {
      cur.lines.push(raw);
    }
  });
  flush();
  return sections;
}

/** Split long text into pieces <= maxChars at paragraph, then sentence boundaries, with overlap. */
export function splitLong(text, maxChars = 450, overlap = 60) {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const units = [];
  for (const p of paras) {
    if (p.length <= maxChars) { units.push(p); continue; }
    const sentences = p.match(/[^。！？!?；;\n.]+[。！？!?；;\n.]*/g) || [p];
    for (const s of sentences) {
      if (s.length <= maxChars) units.push(s);
      else for (let i = 0; i < s.length; i += maxChars - overlap) units.push(s.slice(i, i + maxChars));
    }
  }
  const out = [];
  let buf = '';
  for (const u of units) {
    if (buf && buf.length + u.length + 1 > maxChars) {
      out.push(buf.trim());
      buf = buf.slice(-overlap) + ' ' + u;
    } else buf = buf ? buf + '\n' + u : u;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Parse a file's content into chunks.
 * @returns {{ title: string, chunks: Array<{ord:number, heading:string, text:string, line:number}> }}
 */
export function parseDocument(content, ext, fileName, { maxChars = 450 } = {}) {
  let title = '';
  let body;
  if (ext === '.html' || ext === '.htm') {
    const r = htmlToMarkdownish(content);
    title = r.title;
    body = r.body;
  } else {
    const fm = stripFrontMatter(content);
    title = fm.meta.title || '';
    body = fm.body;
  }
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    title = h1 ? cleanMarkdownInline(h1[1]).trim() : fileName.replace(/\.[^.]+$/, '');
  }
  const sections = splitSections(body, '');
  const chunks = [];
  for (const sec of sections) {
    const text = cleanMarkdownInline(sec.text).replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const heading = sec.headingPath.join(' > ');
    for (const piece of splitLong(text, maxChars)) {
      chunks.push({ ord: chunks.length, heading, text: piece, line: sec.line });
    }
  }
  if (!chunks.length && title) chunks.push({ ord: 0, heading: title, text: title, line: 1 });
  return { title, chunks };
}
