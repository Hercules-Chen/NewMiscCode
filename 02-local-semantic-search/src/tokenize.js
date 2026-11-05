// Keyword tokenization for FTS5.
// CJK text is indexed as overlapping character bigrams (like Lucene's CJKAnalyzer):
// no dictionary needed, works for Traditional Chinese, and 2-character words such as
// "加密" are searchable (the built-in FTS5 trigram tokenizer cannot match < 3 chars).
// Latin/digit runs are kept as lowercase words. The pre-tokenized string is stored in an
// FTS5 column using the unicode61 tokenizer, which then simply splits on spaces.

const CJK = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF\\uAC00-\\uD7AF';
const CJK_ONE = new RegExp(`^[${CJK}]$`, 'u');
const TOKEN_RE = new RegExp(`([${CJK}]+)|([\\p{L}\\p{N}_]+)`, 'gu');

export function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase();
}

/** Returns an array of tokens: CJK bigrams (single char if run length 1) + latin words. */
export function tokenize(text) {
  const out = [];
  const s = normalize(text);
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m[1]) {
      const chars = Array.from(m[1]);
      if (chars.length === 1) out.push(chars[0]);
      else for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
    } else if (m[2]) {
      // split latin word parts out of mixed tokens like "msnodesqlv8" -> keep whole word
      out.push(m[2]);
    }
  }
  return out;
}

/** String stored into FTS5. */
export function toFtsText(text) {
  return tokenize(text).join(' ');
}

/** Build an FTS5 MATCH expression (OR of quoted unique tokens). Returns null if no tokens. */
// Tiny English stopword list so "the/for/a" don't dominate BM25 for natural-language queries.
const STOP = new Set('a an and are as at be by for from how i in is it of on or that the to was what when where which why with'.split(' '));

export function toFtsQuery(query) {
  const all = [...new Set(tokenize(query))];
  const toks = all.filter((t) => !STOP.has(t)).length ? all.filter((t) => !STOP.has(t)) : all;
  if (!toks.length) return null;
  return toks.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/** Terms used for highlighting in the original (un-tokenized) text. */
export function highlightTerms(query) {
  return [...new Set(tokenize(query))].filter((t) => t.length >= 2 || CJK_ONE.test(t)).sort((a, b) => b.length - a.length);
}

const escHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Pick the window of `width` chars with the most term hits and return
 * { html, text, hits } where html is escaped with <mark> around hits.
 */
export function makeSnippet(text, query, width = 140) {
  const terms = highlightTerms(query);
  const norm = normalize(text);
  // NFKC can change length for some chars; fall back to original if lengths differ.
  const hay = norm.length === text.length ? norm : text.toLowerCase();
  const spans = [];
  for (const t of terms) {
    let i = 0;
    while ((i = hay.indexOf(t, i)) !== -1) { spans.push([i, i + t.length]); i += t.length; }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push([...sp]);
  }
  let start = 0;
  if (merged.length && text.length > width) {
    let best = -1;
    for (const [s] of merged) {
      const ws = Math.max(0, s - 20);
      const count = merged.filter(([a, b]) => a >= ws && b <= ws + width).length;
      if (count > best) { best = count; start = ws; }
    }
  }
  const end = Math.min(text.length, start + width);
  let html = '';
  let plain = '';
  let pos = start;
  for (const [a, b] of merged) {
    if (b <= start || a >= end) continue;
    const s = Math.max(a, start), e = Math.min(b, end);
    html += escHtml(text.slice(pos, s)) + '<mark>' + escHtml(text.slice(s, e)) + '</mark>';
    plain += text.slice(pos, s) + '[' + text.slice(s, e) + ']';
    pos = e;
  }
  html += escHtml(text.slice(pos, end));
  plain += text.slice(pos, end);
  const pre = start > 0 ? '…' : '';
  const post = end < text.length ? '…' : '';
  return { html: pre + html + post, text: (pre + plain + post).replace(/\s+/g, ' '), hits: merged.length };
}
