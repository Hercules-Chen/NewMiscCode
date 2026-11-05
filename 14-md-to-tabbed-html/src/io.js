// 輸入讀取（BOM/CRLF 正規化、編碼檢查）與原子寫入（暫存檔 + rename = 整檔寫入）。
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

const fatal = new TextDecoder('utf-8', { fatal: true });
const lenient = new TextDecoder('utf-8');

/**
 * 解碼 Markdown 位元組。回傳 { text, hadBom, hadCrlf, invalidUtf8, replacementChars }。
 * invalidUtf8 = true 代表不是合法 UTF-8（例如 Big5/CP950 檔），text 為寬鬆解碼結果（含 U+FFFD）。
 */
export function decodeInput(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const hadBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  const body = hadBom ? bytes.subarray(3) : bytes;
  let text;
  let invalidUtf8 = false;
  try { text = fatal.decode(body); } catch { invalidUtf8 = true; text = lenient.decode(body); }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 重複 BOM
  const hadCrlf = /\r/.test(text);
  text = text.replace(/\r\n?/g, '\n');
  const replacementChars = (text.match(/\uFFFD/g) || []).length;
  return { text, hadBom, hadCrlf, invalidUtf8, replacementChars };
}

export async function readInput(path) {
  return decodeInput(await readFile(path));
}

/**
 * 原子寫入 UTF-8（無 BOM）：先寫同資料夾暫存檔，再 rename 取代目標。
 * 寫完立即讀回稽核：位元組必須與預期完全相同、無 BOM、為合法 UTF-8。
 */
export async function atomicWriteText(path, text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const data = Buffer.from(text, 'utf8');
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  const back = await readFile(path);
  const problems = [];
  if (!back.equals(data)) problems.push('content mismatch after write');
  if (back.length >= 3 && back[0] === 0xEF && back[1] === 0xBB && back[2] === 0xBF) problems.push('BOM present');
  try { fatal.decode(back); } catch { problems.push('invalid UTF-8'); }
  return { bytes: data.length, problems };
}
