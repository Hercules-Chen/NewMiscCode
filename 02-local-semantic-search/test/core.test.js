import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, toFtsQuery, makeSnippet } from '../src/tokenize.js';
import { parseDocument, htmlToMarkdownish } from '../src/parse.js';
import { reciprocalRankFusion } from '../src/search.js';

test('tokenize: CJK bigrams + latin words + NFKC full-width', () => {
  assert.deepEqual(tokenize('欄位加密'), ['欄位', '位加', '加密']);
  assert.deepEqual(tokenize('密'), ['密']);
  assert.deepEqual(tokenize('ＡＢＣ msnodesqlv8 連線'), ['abc', 'msnodesqlv8', '連線']);
});

test('toFtsQuery: quoted OR expression, stopwords dropped, null for empty', () => {
  assert.equal(toFtsQuery('the 加密'), '"加密"');
  assert.equal(toFtsQuery('   '), null);
  assert.equal(toFtsQuery('x"y'), '"x" OR "y"');
});

test('makeSnippet: highlights CJK and escapes HTML', () => {
  const s = makeSnippet('<b>Always Encrypted</b> 資料行加密金鑰', '加密 金鑰');
  assert.match(s.html, /&lt;b&gt;/);
  assert.match(s.html, /<mark>加密金鑰<\/mark>/);
  assert.ok(s.hits >= 1);
});

test('parseDocument: markdown front matter, heading path, code fence', () => {
  const md = '---\ntitle: T1\n---\n# H1\nintro\n## Sub\n```\n# not a heading\n```\nbody text';
  const { title, chunks } = parseDocument(md, '.md', 'x.md');
  assert.equal(title, 'T1');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].heading, 'H1 > Sub');
  assert.match(chunks[1].text, /# not a heading/);
});

test('parseDocument: long sections are split', () => {
  const long = '# A\n' + '這是一個很長的句子。'.repeat(120);
  const { chunks } = parseDocument(long, '.md', 'a.md', { maxChars: 300 });
  assert.ok(chunks.length >= 3, `got ${chunks.length}`);
  assert.ok(chunks.every((c) => c.text.length <= 300 + 80));
});

test('htmlToMarkdownish: drops script/style, keeps headings and entities', () => {
  const r = htmlToMarkdownish('<html><head><title>標題</title><style>x{}</style></head><body><h2>Sec &amp; 1</h2><p>a&lt;b</p><script>evil()</script></body></html>');
  assert.equal(r.title, '標題');
  assert.match(r.body, /## Sec & 1/);
  assert.match(r.body, /a<b/);
  assert.doesNotMatch(r.body, /evil/);
});

test('reciprocalRankFusion: item in both lists wins', () => {
  const f = reciprocalRankFusion([{ name: 'keyword', ids: [1, 2, 3] }, { name: 'semantic', ids: [3, 4] }]);
  const best = [...f.entries()].sort((a, b) => b[1].rrf - a[1].rrf)[0];
  assert.equal(best[0], 3);
  assert.deepEqual(best[1].ranks, { keyword: 3, semantic: 1 });
});
