// Pure helpers shared by the browser binding and unit tests.
// All indices are UTF-16 code units (same as <textarea> and Y.Text).

const isHigh = c => c >= 0xd800 && c <= 0xdbff;
const isLow = c => c >= 0xdc00 && c <= 0xdfff;

/**
 * Minimal single-region diff: common prefix + common suffix.
 * Never splits a surrogate pair (emoji etc.).
 * @returns {{index:number, remove:number, insert:string}}
 */
export function diffText(a, b) {
  if (a === b) return { index: 0, remove: 0, insert: '' };
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  if (p > 0 && p < a.length && isHigh(a.charCodeAt(p - 1)) && isLow(a.charCodeAt(p))) p--;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  if (s > 0 && s < a.length - p && isLow(a.charCodeAt(a.length - s)) && isHigh(a.charCodeAt(a.length - s - 1))) s--;
  return { index: p, remove: a.length - p - s, insert: b.slice(p, b.length - s) };
}

/**
 * Map an index through a Yjs delta ([{retain}|{insert}|{delete}]).
 * assocRight=true: an insertion exactly at `pos` pushes the index to the right.
 */
export function mapIndexThroughDelta(delta, pos, assocRight = false) {
  let cursor = 0; // position in the old document
  let shift = 0;
  for (const op of delta) {
    if (op.retain != null) {
      cursor += op.retain;
      if (cursor > pos) break;
    } else if (op.insert != null) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (cursor < pos || (cursor === pos && assocRight)) shift += len;
      else break;
    } else if (op.delete != null) {
      if (cursor >= pos) break;
      const end = cursor + op.delete;
      shift -= Math.min(end, pos) - cursor;
      cursor = end;
    }
  }
  return Math.max(0, pos + shift);
}

/** Map an index through a list of deltas applied in order. */
export function mapIndexThroughDeltas(deltas, pos, assocRight = false) {
  for (const d of deltas) pos = mapIndexThroughDelta(d, pos, assocRight);
  return pos;
}
