import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { slugify, Slugger } from '../src/slug.js';
import { decodeInput, atomicWriteText } from '../src/io.js';
import { renderDocument, parseFrontMatter } from '../src/render.js';
import { buildHtml, buildFile, EncodingError } from '../src/build.js';
import { checkHtml } from '../src/check.js';
import { defaultLogDir } from '../src/env.js';

test('slug: Chinese headings are kept and stable', () => {
  assert.equal(slugify('快速開始'), '快速開始');
  assert.equal(slugify('快速開始（Windows / Linux）'), '快速開始windows-linux');
  assert.equal(slugify('除錯與日誌'), '除錯與日誌');
  assert.equal(slugify('Ｆｕｌｌ　Width ＡＢＣ'), 'full-width-abc'); // NFKC
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('v1.2 版本'), 'v12-版本');
  assert.equal(slugify('！？'), 'section');
  assert.equal(slugify('快速開始'), slugify('快速開始')); // deterministic
});

test('slug: duplicates get -2, -3 and "all" is reserved', () => {
  const s = new Slugger();
  assert.deepEqual(['說明', '說明', '說明', 'all'].map(x => s.slug(x)), ['說明', '說明-2', '說明-3', 'all-2']);
  assert.equal(s.slug('whatever', 'custom'), 'custom');
});

test('front matter is optional and parsed', () => {
  assert.deepEqual(parseFrontMatter('---\ntitle: "T"\nlang: en\n---\nbody').meta, { title: 'T', lang: 'en' });
  assert.deepEqual(parseFrontMatter('## a').meta, {});
});

test('tab splitting: each ## is a tab, ### are sub-anchors, h1 becomes the title', async () => {
  const doc = await renderDocument('# 標題\n\n前言\n\n## 概覽\n\n文字\n\n### 子節\n\nx\n\n## 安裝 {#install}\n\ny\n\n### 子節\n\nz\n');
  assert.equal(doc.title, '標題');
  assert.match(doc.preface, /前言/);
  assert.deepEqual(doc.tabs.map(t => t.id), ['概覽', 'install']);
  assert.deepEqual(doc.tabs.map(t => t.subs.map(s => s.id)), [['子節'], ['子節-2']]);
  assert.match(doc.tabs[1].html, /<h3 id="子節-2">/);
  assert.doesNotMatch(doc.tabs[0].html, /<h2 id=/); // id lives on section.tab
});

test('no ## headings -> single tab with warning', async () => {
  const doc = await renderDocument('just text');
  assert.equal(doc.tabs.length, 1);
  assert.ok(doc.warnings.some(w => w.key === 'noTabs'));
});

test('admonitions render as styled cards (default and custom title)', async () => {
  const doc = await renderDocument('## A\n\n> [!NOTE]\n> 內容一\n\n> [!WARNING] 自訂\n> 內容二\n\n> [!TIP] 只有標題\n\n> 普通引用\n', {});
  const h = doc.tabs[0].html;
  assert.match(h, /<div class="admonition note" role="note">\n<p class="admonition-title">備註<\/p>\n<p>內容一<\/p>\n<\/div>/);
  assert.match(h, /admonition warning[\s\S]*?admonition-title">自訂<\/p>\n<p>內容二<\/p>/);
  assert.match(h, /admonition tip[\s\S]*?只有標題/);
  assert.match(h, /<blockquote>\n<p>普通引用<\/p>/);
  const en = await renderDocument('---\nlang: en\n---\n## A\n\n> [!CAUTION]\n> x\n');
  assert.match(en.tabs[0].html, /admonition-title">Caution</);
});

test('task lists and GFM tables', async () => {
  const doc = await renderDocument('## A\n\n- [x] 完成\n- [ ] 未完成\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  const h = doc.tabs[0].html;
  assert.match(h, /<li class="task-item"><input type="checkbox" disabled checked> 完成<\/li>/);
  assert.match(h, /<input type="checkbox" disabled> 未完成/);
  assert.match(h, /<div class="table-wrap"><table>/);
});

test('input normalization: BOM and CRLF removed', () => {
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('## 概覽\r\n\r\n內容\r\n', 'utf8')]);
  const r = decodeInput(buf);
  assert.equal(r.hadBom, true);
  assert.equal(r.hadCrlf, true);
  assert.equal(r.invalidUtf8, false);
  assert.equal(r.text, '## 概覽\n\n內容\n');
});

test('Big5 input is detected as invalid UTF-8 and refused (no mojibake output)', async () => {
  const big5 = new URL('../testdata/big5.md', import.meta.url).pathname;
  const r = decodeInput(await readFile(big5));
  assert.equal(r.invalidUtf8, true);
  const dir = await mkdtemp(join(os.tmpdir(), 'md2tabs-'));
  await assert.rejects(buildFile(big5, { out: join(dir, 'x.html') }), EncodingError);
  assert.deepEqual(await readdir(dir), []); // nothing written
  const forced = await buildFile(big5, { out: join(dir, 'x.html'), allowInvalid: true });
  assert.ok(forced.warnings.some(w => w.key === 'invalidForced'));
});

test('U+FFFD in valid UTF-8 input produces a warning', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'md2tabs-'));
  await writeFile(join(dir, 'a.md'), '## A\n\n壞掉\uFFFD的字\n');
  const r = await buildFile(join(dir, 'a.md'), {});
  assert.ok(r.warnings.some(w => w.key === 'fffd'));
});

test('atomic write: UTF-8 without BOM, no temp files left, whole-file replace', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'md2tabs-'));
  const f = join(dir, 'out.html');
  await writeFile(f, 'old content that is much longer than the new one');
  const r = await atomicWriteText(f, '\uFEFF中文內容');
  assert.deepEqual(r.problems, []);
  const buf = await readFile(f);
  assert.notDeepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(buf.toString('utf8'), '中文內容');
  assert.deepEqual(await readdir(dir), ['out.html']);
});

test('build from BOM+CRLF file: output has no BOM and no CR', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'md2tabs-'));
  await writeFile(join(dir, 'a.md'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('## 概覽\r\n\r\n內容\r\n', 'utf8')]));
  const r = await buildFile(join(dir, 'a.md'), {});
  assert.ok(r.warnings.some(w => w.key === 'bom') && r.warnings.some(w => w.key === 'crlf'));
  const buf = await readFile(join(dir, 'a.html'));
  assert.notEqual(buf[0], 0xEF);
  assert.ok(!buf.includes(0x0D));
});

test('check: broken anchor, duplicate id and empty tab are reported', async () => {
  const { html } = await buildHtml('## A\n\n[壞連結](#不存在)\n\n### X\n\n### X {#x}\n\n<p id="x">dup</p>\n\n## B\n');
  const { problems } = await checkHtml(html);
  assert.ok(problems.includes('broken anchor #不存在'), problems.join('\n'));
  assert.ok(problems.some(p => p.startsWith('duplicate id')), problems.join('\n'));
  assert.ok(problems.includes('tab "b" is empty'), problems.join('\n'));
  const ok = await checkHtml((await buildHtml('## A\n\n[ok](#子)\n\n### 子\n\nx\n')).html);
  assert.deepEqual(ok.problems, []);
});

test('log dir default: Windows ProgramData, Linux ./logs', () => {
  assert.equal(defaultLogDir('win32', { ProgramData: 'C:\\ProgramData' }).replace(/\//g, '\\'), 'C:\\ProgramData\\NewMiscCode\\14-md-to-tabbed-html');
  assert.match(defaultLogDir('linux', {}), /14-md-to-tabbed-html[\\/]logs$/);
});
