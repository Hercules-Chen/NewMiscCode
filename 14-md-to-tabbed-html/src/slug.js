// 錨點 id（slug）規則。 Slug rule for heading ids — stable for Chinese headings.
//
// 1. 標題結尾若有 {#custom-id}，直接使用該 id（只允許 [A-Za-z0-9_-] 與中日韓文字）。
// 2. 否則：NFKC 正規化（全形英數→半形）→ 轉小寫 → 刪除「字母/數字/組合記號/空白/-/_」以外的字元
//    （全形標點如（）：、。也會刪除）→ 連續空白與底線以外的空白轉成單一 "-" → 合併多個 "-" → 去頭尾 "-"。
//    中文字屬於 \p{L}，因此原樣保留：「快速開始（Windows）」→「快速開始windows」。
// 3. 結果為空 → "section"。
// 4. 同一份文件內重複 → 依出現順序加 "-2"、"-3"…；保留字 "all"（全部顯示）也會被加尾碼。
export function slugify(text) {
  const s = String(text).normalize('NFKC').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

export const CUSTOM_ID = /\s*\{#([\p{L}\p{N}_-]+)\}\s*$/u;

export class Slugger {
  constructor(reserved = ['all']) { this.used = new Set(reserved); }
  slug(text, explicit) {
    const base = explicit || slugify(text);
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    return id;
  }
}
