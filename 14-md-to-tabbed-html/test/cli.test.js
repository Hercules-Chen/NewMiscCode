import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const CLI = new URL('../src/cli.js', import.meta.url).pathname;
async function cli(args, opts = {}) {
  try { const r = await run(process.execPath, [CLI, ...args, '--no-log'], opts); return { code: 0, ...r }; }
  catch (e) { return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
}

test('--check catches a broken anchor and exits 1', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'md2tabs-'));
  await writeFile(join(dir, 'bad.md'), '## 概覽\n\n[去](#不存在的節)\n');
  const r = await cli(['build', join(dir, 'bad.md'), '--check', '--lang', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /broken anchor #不存在的節/);
  const ok = await cli(['build', join(dir, 'bad.md')]); // without --check the build itself succeeds
  assert.equal(ok.code, 0);
  const chk = await cli(['check', join(dir, 'bad.html')]);
  assert.equal(chk.code, 1);
});

test('Big5 input exits 3 with a clear zh-TW message', async () => {
  const r = await cli(['build', new URL('../testdata/big5.md', import.meta.url).pathname, '--out', join(os.tmpdir(), 'md2tabs-big5.html')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /不是合法的 UTF-8/);
});

test('folder mode: every *.md -> .html, cross-doc links rewritten, index generated, --check passes', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'md2tabs-'));
  await writeFile(join(dir, 'a.md'), '# 文件 A\n\n## 概覽\n\n見 [B 的安裝](b.md#安裝)\n');
  await writeFile(join(dir, 'b.md'), '# 文件 B\n\n## 說明\n\n### 安裝\n\nok\n');
  const out = join(dir, 'site');
  await mkdir(out);
  const r = await cli(['build', dir, '--out', out, '--check', '--lang', 'en']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /index .*\(2 documents\)/);
  const a = await readFile(join(out, 'a.html'), 'utf8');
  assert.match(a, /href="b.html#安裝"/);
  const idx = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(idx, /href="a.html">文件 A</);
});

test('usage errors exit 2; help works in both languages', async () => {
  assert.equal((await cli(['frobnicate'])).code, 2);
  assert.equal((await cli(['build'])).code, 2);
  assert.match((await cli(['help', '--lang', 'en'])).stdout, /Exit codes/);
  assert.match((await cli(['help'])).stdout, /結束碼/);
});
