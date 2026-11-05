// 建置後驗證。 Post-build validation of a generated HTML string.
import { access, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const decodeEnt = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const exists = p => access(p).then(() => true, () => false);

export function collectIds(html) {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
  return [...noScript.matchAll(/\sid="([^"]*)"/g)].map(m => decodeEnt(m[1]));
}

/**
 * 回傳 { checks, problems[] }。
 * - 沒有重複 id
 * - 所有 href="#x" 都有對應 id（#all 為保留的「全部顯示」）
 * - 每個分頁（section.tab）除了 h2 之外有內容
 * - 相對連結/圖片的檔案存在；指向 .html#x 時 x 必須存在於目標檔
 */
export async function checkHtml(html, { file, extraIds } = {}) {
  const problems = [];
  let checks = 0;
  const ids = collectIds(html);
  const idSet = new Set(ids);
  const seen = new Set();
  for (const id of ids) {
    checks++;
    if (!id) problems.push('empty id=""');
    else if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    seen.add(id);
  }
  const tabs = [...html.matchAll(/<section class="tab" id="([^"]*)">([\s\S]*?)<\/section>/g)];
  if (!tabs.length) problems.push('no tabs (section.tab) found');
  for (const [, id, inner] of tabs) {
    checks++;
    const rest = inner.replace(/<h2[\s\S]*?<\/h2>/, '').replace(/<div class="toc"[\s\S]*?<\/div>/, '');
    const hasMedia = /<(img|table|pre|svg|video|iframe|input)\b/i.test(rest);
    if (!hasMedia && !rest.replace(/<[^>]+>/g, '').trim()) problems.push(`tab "${decodeEnt(id)}" is empty`);
  }
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const dir = file ? dirname(resolve(file)) : process.cwd();
  const targetCache = new Map();
  for (const m of body.matchAll(/\s(href|src)="([^"]*)"/g)) {
    const url = decodeEnt(m[2]);
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue;
    checks++;
    if (url.startsWith('#')) {
      const id = safeDecode(url.slice(1));
      if (url === '#') problems.push('empty anchor href="#"');
      else if (id !== 'all' && !idSet.has(id)) problems.push(`broken anchor ${url}`);
      continue;
    }
    const [p, hash] = url.split('#');
    const target = resolve(dir, safeDecode(p));
    if (!(await exists(target)) && !(extraIds && extraIds.has(target))) { problems.push(`missing ${m[1]} target: ${url}`); continue; }
    if (hash && /\.html?$/i.test(target)) {
      if (!targetCache.has(target)) {
        const pending = extraIds && extraIds.get(target);
        targetCache.set(target, pending || new Set(collectIds(await readFile(target, 'utf8')).concat(['all'])));
      }
      if (!targetCache.get(target).has(safeDecode(hash))) problems.push(`broken link ${url}: id "${safeDecode(hash)}" not in target`);
    }
  }
  return { checks, problems };
}
