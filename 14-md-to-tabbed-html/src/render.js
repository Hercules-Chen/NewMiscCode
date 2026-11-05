// Markdown → 分頁結構。 Markdown to tab structure (markdown-it 14, pinned).
import MarkdownIt from 'markdown-it';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, extname, sep } from 'node:path';
import { Slugger, CUSTOM_ID } from './slug.js';
import { pageStrings } from './i18n.js';

/** 簡易 front matter：開頭 --- 與 --- 之間的 key: value（值可加引號）。 */
export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function createMarkdown() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  // 表格包一層 .table-wrap：手機上只在表格內水平捲動，頁面本身不捲動。
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  return md;
}

const ADMONITION = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)\n?/i;
const TASK = /^\[([ xX])\][ \t]+/;

function reparse(md, env, inline, content) {
  inline.content = content;
  inline.children = [];
  md.inline.parse(content, md, env, inline.children);
}

function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 告示卡片 > [!NOTE] 與任務清單 - [ ] / - [x]。直接改寫 token。 */
function transformBlocks(md, env, tokens, strings) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'blockquote_open' && tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
      const inline = tokens[i + 2];
      const m = ADMONITION.exec(inline.content);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      // 找對應的 blockquote_close
      let depth = 0, j = i;
      for (; j < tokens.length; j++) {
        if (tokens[j].type === 'blockquote_open') depth++;
        else if (tokens[j].type === 'blockquote_close' && --depth === 0) break;
      }
      t.tag = 'div'; t.attrSet('class', `admonition ${kind}`); t.attrSet('role', 'note');
      tokens[j].tag = 'div';
      const title = m[2].trim() || strings.adm[kind];
      const rest = inline.content.slice(m[0].length);
      const head = Object.assign(new (t.constructor)('html_block', '', 0), { content: `<p class="admonition-title">${md.renderInline(title, env)}</p>\n`, block: true });
      if (rest.trim()) {
        reparse(md, env, inline, rest);
        tokens.splice(i + 1, 0, head);
      } else {
        tokens.splice(i + 1, 3, head); // 標記獨佔一段：移除該段落
      }
    }
    if (t.type === 'list_item_open' && tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
      const inline = tokens[i + 2];
      const m = TASK.exec(inline.content);
      if (!m) continue;
      reparse(md, env, inline, inline.content.slice(m[0].length));
      const box = new (t.constructor)('html_inline', '', 0);
      box.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
      inline.children.unshift(box);
      t.attrJoin('class', 'task-item');
    }
  }
}

function inlineText(inline) {
  return (inline.children || []).map(c => (c.type === 'text' || c.type === 'code_inline') ? c.content
    : c.children ? inlineText(c) : '').join('');
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const isRelative = u => u && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u);
const toPosix = p => p.split(sep).join('/');

/** 圖片：內嵌（--embed-images）或改寫為相對輸出檔的路徑；連結：.md → .html 並改寫相對路徑。 */
async function transformLinks(tokens, ctx) {
  const walk = async list => {
    for (const t of list) {
      if (t.children) await walk(t.children);
      if (t.type === 'image') {
        const src = t.attrGet('src');
        if (!isRelative(src)) continue;
        const file = resolve(ctx.srcDir, decodeURIComponent(src.split(/[?#]/)[0]));
        let info = null;
        try { info = await stat(file); } catch { /* missing */ }
        if (!info) { ctx.warnings.push({ key: 'imgMissing', args: [src] }); ctx.problems.push(`image not found: ${src}`); continue; }
        const mime = MIME[extname(file).toLowerCase()];
        if (ctx.embedImages && mime) {
          const kb = Math.round(info.size / 1024);
          if (kb > ctx.maxImageKb) ctx.warnings.push({ key: 'imgBig', args: [src, kb] });
          t.attrSet('src', `data:${mime};base64,${(await readFile(file)).toString('base64')}`);
          ctx.images.push({ src, bytes: info.size, embedded: true });
        } else {
          t.attrSet('src', toPosix(relative(ctx.outDir, file)) || '.');
          ctx.images.push({ src, bytes: info.size, embedded: false });
        }
        t.attrSet('loading', 'lazy');
      } else if (t.type === 'link_open') {
        const href = t.attrGet('href');
        // markdown-it 會把 #中文 百分比編碼；還原成原字元，與 id 完全一致（工具與人都好比對）
        if (href && href.startsWith('#')) { try { t.attrSet('href', '#' + decodeURIComponent(href.slice(1))); } catch { /* keep */ } continue; }
        if (!isRelative(href)) continue;
        const [p, hash] = href.split('#');
        if (!p) continue;
        const mapped = ctx.mdOutDir ? p.replace(/\.md$/i, '.html') : p; // 只有資料夾模式把 .md 連結改成 .html
        const target = resolve(ctx.srcDir, decodeURIComponent(mapped));
        const rel = /\.md$/i.test(p) && ctx.mdOutDir ? toPosix(relative(ctx.outDir, resolve(ctx.mdOutDir, decodeURIComponent(mapped))))
          : toPosix(relative(ctx.outDir, target));
        let frag = hash;
        try { frag = hash !== undefined ? decodeURIComponent(hash) : hash; } catch { /* keep */ }
        t.attrSet('href', encodeURI(rel) + (frag !== undefined ? '#' + frag : ''));
      }
    }
  };
  await walk(tokens);
}

/**
 * 把 Markdown 文字轉成 { meta, title, preface, tabs:[{id,title,html,subs:[{id,title}]}] }。
 * opts: { srcPath, outPath, embedImages, maxImageKb, mdOutDir }
 */
export async function renderDocument(text, opts = {}) {
  const { meta, body } = parseFrontMatter(text);
  const lang = meta.lang || 'zh-TW';
  const strings = pageStrings(lang);
  const md = createMarkdown();
  const env = {};
  const tokens = md.parse(body, env);
  transformBlocks(md, env, tokens, strings);
  const ctx = {
    srcDir: dirname(resolve(opts.srcPath || 'doc.md')), outDir: dirname(resolve(opts.outPath || opts.srcPath || 'doc.html')),
    mdOutDir: opts.mdOutDir, embedImages: !!opts.embedImages, maxImageKb: opts.maxImageKb ?? 1024,
    warnings: [], problems: [], images: [],
  };
  await transformLinks(tokens, ctx);

  // 標題 id、第一個 h1 當標題、依 ## 切分頁
  const slugger = new Slugger();
  let title = meta.title || '';
  const preface = [];
  const tabs = [];
  let cur = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const inline = tokens[i + 1];
      const m = CUSTOM_ID.exec(inline.content);
      if (m) reparse(md, env, inline, inline.content.slice(0, m.index));
      const text = inlineText(inline).trim();
      if (t.tag === 'h1' && !tabs.length && !cur) {
        if (!title) title = text;
        i += 2; // 移除 h1（已成為頁面標題）
        continue;
      }
      const id = slugger.slug(text, m && m[1]);
      if (t.tag !== 'h2') t.attrSet('id', id); // h2 的 id 放在 section.tab 上
      if (t.tag === 'h2') {
        cur = { id, title: text, tokens: [], subs: [] };
        tabs.push(cur);
        cur.tokens.push(t, tokens[i + 1], tokens[i + 2]);
        i += 2;
        continue;
      }
      if (t.tag === 'h3' && cur) {
        cur.subs.push({ id, title: text });
        // 加一個可複製的錨點連結
        const a = new (t.constructor)('html_inline', '', 0);
        a.content = ` <a class="anchor" href="#${htmlEscape(id)}" aria-label="${htmlEscape(text)}">#</a>`;
        inline.children.push(a);
      }
    }
    (cur ? cur.tokens : preface).push(t);
  }
  if (!title) title = meta.title || (opts.srcPath ? opts.srcPath.replace(/^.*[\\/]/, '').replace(/\.md$/i, '') : 'Document');
  if (!tabs.length) {
    ctx.warnings.push({ key: 'noTabs', args: [opts.srcPath || '(input)'] });
    tabs.push({ id: slugger.slug(strings.docs), title, tokens: preface.splice(0), subs: [] });
  }
  const render = list => md.renderer.render(list, md.options, env);
  return {
    meta, lang, title, strings,
    subtitle: meta.subtitle || '',
    footer: meta.footer || '',
    preface: render(preface),
    tabs: tabs.map(t => ({ id: t.id, title: t.title, subs: t.subs, html: render(t.tokens) })),
    warnings: ctx.warnings, problems: ctx.problems, images: ctx.images,
  };
}
