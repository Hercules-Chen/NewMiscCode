// R6: byte-level encoding hygiene (.bat ASCII, .ps1 BOM if non-ASCII, .cs/.md valid UTF-8).
import { extname } from 'node:path';
import { message } from '../i18n.js';

const hex = b => b.toString(16).toUpperCase().padStart(2, '0');

/** Index of the first invalid UTF-8 byte, or -1. */
export function firstInvalidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    let n, min;
    if (b >= 0xC2 && b <= 0xDF) { n = 1; min = 0x80; }
    else if (b >= 0xE0 && b <= 0xEF) { n = 2; min = 0x800; }
    else if (b >= 0xF0 && b <= 0xF4) { n = 3; min = 0x10000; }
    else return i;
    let cp = b & (0x3F >> n);
    for (let k = 1; k <= n; k++) {
      const c = buf[i + k];
      if (c === undefined || (c & 0xC0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3F);
    }
    if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return i;
    i += n + 1;
  }
  return -1;
}

/** 1-based line/column of a byte offset (column counts bytes; good enough for the first bad byte). */
function lineCol(buf, offset) {
  let line = 1, lastNl = -1;
  for (let i = 0; i < offset; i++) if (buf[i] === 0x0A) { line++; lastNl = i; }
  return { line, column: offset - lastNl };
}

export function checkEncoding(buf, relPath, cfg) {
  const ext = extname(relPath).toLowerCase();
  const out = [];
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const firstNonAscii = buf.findIndex(b => b > 0x7F);
  const add = (offset, key, params, suggestion) => {
    const lc = lineCol(buf, Math.max(0, offset));
    out.push({ ruleId: 'R6', ...lc, endLine: lc.line, endColumn: lc.column + 1, message: message(key, { ext, ...params }), suggestion });
  };
  if ((cfg.asciiOnly || []).includes(ext)) {
    if (firstNonAscii >= 0) add(firstNonAscii, 'R6.ascii', { byte: hex(buf[firstNonAscii]) }, 'rem Use ASCII only in .bat; put Chinese text in the .ps1 (UTF-8 with BOM) that the .bat calls.');
    return out;
  }
  const bad = firstInvalidUtf8(hasBom ? buf.subarray(3) : buf);
  if ((cfg.bomIfNonAscii || []).includes(ext)) {
    if (bad >= 0) add(bad + (hasBom ? 3 : 0), 'R6.utf8', { offset: bad + (hasBom ? 3 : 0), byte: hex(buf[bad + (hasBom ? 3 : 0)]) }, 'Re-save as "UTF-8 with BOM".');
    else if (firstNonAscii >= 0 && !hasBom) add(firstNonAscii, 'R6.bom', {}, 'Re-save as "UTF-8 with BOM" (VS Code: Save with Encoding > UTF-8 with BOM).');
    return out;
  }
  if ((cfg.utf8 || []).includes(ext)) {
    if (bad >= 0) {
      const off = bad + (hasBom ? 3 : 0);
      add(off, 'R6.utf8', { offset: off, byte: hex(buf[off]) }, 'Convert to UTF-8 (e.g. VS Code: Reopen with Encoding > Big5, then Save with Encoding > UTF-8).');
      return out;
    }
    if (hasBom && (cfg.bomForbidden || []).includes(ext)) add(0, 'R6.bomForbidden', {}, 'Save as UTF-8 (without BOM).');
    const text = buf.toString('utf8');
    const fffd = text.indexOf(String.fromCharCode(0xFFFD));
    if (fffd >= 0) add(Buffer.byteLength(text.slice(0, fffd)), 'R6.fffd', {}, 'Restore the original characters from version control.');
  }
  return out;
}

export function isEncodingTarget(relPath, cfg) {
  const ext = extname(relPath).toLowerCase();
  return [...(cfg.asciiOnly || []), ...(cfg.bomIfNonAscii || []), ...(cfg.utf8 || [])].includes(ext);
}
