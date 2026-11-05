// 建置：單檔與資料夾模式。 Build a single file or a folder of *.md.
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, basename, dirname, relative, extname, sep } from 'node:path';
import { readInput, atomicWriteText } from './io.js';
import { renderDocument } from './render.js';
import { renderPage } from './template.js';
import { checkHtml } from './check.js';
import { VERSION } from './env.js';
import { pageStrings } from './i18n.js';

export class EncodingError extends Error {}

/** Markdown 文字 → 完整 HTML（純函式，不寫檔）。 */
export async function buildHtml(text, opts = {}) {
  const doc = await renderDocument(text, opts);
  return { doc, html: renderPage(doc, { version: VERSION }) };
}

/**
 * 建置單一檔案。回傳 { input, output, tabs, bytes, warnings[], problems[] }。
 * opts: { out, embedImages, maxImageKb, allowInvalid, check, mdOutDir, log, skipCheck }
 */
export async function buildFile(input, opts = {}) {
  const log = opts.log;
  const output = resolve(opts.out || input.replace(/\.md$/i, '') + '.html');
  const src = await readInput(input);
  const warnings = [];
  if (src.hadBom) warnings.push({ key: 'bom', args: [input] });
  if (src.hadCrlf) warnings.push({ key: 'crlf', args: [input] });
  if (src.invalidUtf8) {
    log?.warn('invalid utf-8 input', { input });
    if (!opts.allowInvalid) throw Object.assign(new EncodingError(`invalid UTF-8: ${input}`), { input });
    warnings.push({ key: 'invalidForced', args: [input] });
  } else if (src.replacementChars) {
    warnings.push({ key: 'fffd', args: [input, src.replacementChars] });
  }
  const { doc, html } = await buildHtml(src.text, { ...opts, srcPath: input, outPath: output });
  warnings.push(...doc.warnings);
  const { bytes, problems: audit } = await atomicWriteText(output, html);
  log?.info('wrote', { input, output, bytes, tabs: doc.tabs.length, images: doc.images.length, hadBom: src.hadBom, hadCrlf: src.hadCrlf });
  for (const w of warnings) log?.warn(w.key, { args: w.args });
  const problems = audit.map(p => `post-write audit: ${p}`);
  return { input, output, html, title: doc.title, tabs: doc.tabs.length, tabIds: doc.tabs.map(t => t.id), bytes, warnings, problems };
}

/** 資料夾模式：每個 *.md（不遞迴）→ .html，另外產生 index.html（若沒有 index.md）。 */
export async function buildFolder(dir, opts = {}) {
  const outDir = resolve(opts.out || dir);
  const names = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => e.name).sort();
  const results = [];
  for (const name of names) {
    results.push(await buildFile(join(dir, name), { ...opts, out: join(outDir, name.replace(/\.md$/i, '.html')), mdOutDir: outDir }));
  }
  let index = null;
  if (names.length && !names.some(n => /^index\.md$/i.test(n))) {
    const s = pageStrings(opts.pageLang || 'zh-TW');
    const rows = results.map(r => `| [${r.title.replace(/[|[\]]/g, ' ')}](${encodeURI(relative(outDir, r.output).split(sep).join('/'))}) | ${r.tabs} | \`${basename(r.input)}\` |`).join('\n');
    const head = opts.pageLang === 'en' ? '| Document | Tabs | Source |' : '| 文件 | 分頁數 | 來源 |';
    const md = `---\ntitle: ${basename(resolve(dir))}\nlang: ${opts.pageLang || 'zh-TW'}\n---\n\n## ${s.docs} {#docs}\n\n${head}\n|---|---|---|\n${rows}\n`;
    const { html } = await buildHtml(md, { srcPath: join(outDir, 'index.md'), outPath: join(outDir, 'index.html') });
    const out = join(outDir, 'index.html');
    const { bytes, problems } = await atomicWriteText(out, html);
    opts.log?.info('wrote index', { output: out, bytes, docs: results.length });
    index = { output: out, html, bytes, problems: problems.map(p => `post-write audit: ${p}`) };
  }
  return { results, index, count: names.length };
}

export async function isDirectory(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

export { checkHtml, extname, dirname };
