import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchAny } from '../src/glob.js';
import { firstInvalidUtf8, checkEncoding } from '../src/rules/r6-encoding.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { parseArgs } from '../src/cli.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './helpers.js';

test('glob', () => {
  assert.ok(globToRegExp('**/*.Tests/**').test('a/b/My.Tests/x/y.cs'));
  assert.ok(globToRegExp('**/*.Tests/**').test('My.Tests/y.cs'));
  assert.ok(!globToRegExp('**/*.Tests/**').test('MyTests/y.cs'));
  assert.ok(globToRegExp('src/{a,b}/*.cs').test('src/b/x.cs'));
  assert.equal(matchAny('x/Startup.cs', ['Startup.cs']), 'Startup.cs');
});

test('UTF-8 validator', () => {
  assert.equal(firstInvalidUtf8(Buffer.from('中文 abc', 'utf8')), -1);
  assert.equal(firstInvalidUtf8(Buffer.from([0x61, 0xA4, 0xA4])), 1); // Big5 "中"
  assert.equal(firstInvalidUtf8(Buffer.from([0xED, 0xA0, 0x80])), 0); // surrogate
  assert.equal(firstInvalidUtf8(Buffer.from([0xE4, 0xB8])), 0); // truncated
  assert.equal(firstInvalidUtf8(Buffer.from([0xC0, 0x80])), 0); // overlong
});

test('R6 checks', () => {
  const c = DEFAULT_CONFIG.rules.R6;
  assert.equal(checkEncoding(Buffer.from('@echo off\r\n'), 'a.bat', c).length, 0);
  assert.equal(checkEncoding(Buffer.from('echo 中\r\n'), 'a.bat', c).length, 1);
  assert.equal(checkEncoding(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('# 中')]), 'a.ps1', c).length, 0);
  assert.equal(checkEncoding(Buffer.from('# 中'), 'a.ps1', c).length, 1);
  assert.equal(checkEncoding(Buffer.from('# ascii'), 'a.ps1', c).length, 0);
  assert.equal(checkEncoding(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('class A {}')]), 'a.cs', c).length, 0, '.cs with BOM is fine');
  assert.equal(checkEncoding(Buffer.from('x \uFFFD y'), 'a.md', c)[0].message.en.includes('U+FFFD'), true);
});

test('parseArgs', () => {
  const o = parseArgs(['src', '--rules', 'r1,R3', '--sarif=out.sarif', '--debug']);
  assert.deepEqual(o.rules, ['R1', 'R3']);
  assert.equal(o.sarif, 'out.sarif');
  assert.equal(o.debug, true);
  assert.throws(() => parseArgs(['--format', 'xml']));
});

test('Windows launchers: .bat pure ASCII + CRLF, .ps1 UTF-8 with BOM', async () => {
  const names = await readdir(ROOT);
  const bats = names.filter(n => n.endsWith('.bat'));
  assert.deepEqual(bats.sort(), ['csrules.bat', 'run-sample.bat', 'run-tests.bat', 'setup.bat']);
  for (const b of bats) {
    const buf = await readFile(join(ROOT, b));
    assert.ok(buf.every(x => x < 0x80), `${b} ASCII`);
    const text = buf.toString('latin1');
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, `${b} CRLF only`);
    assert.match(text, /pushd "%~dp0"/);
    assert.match(text, /exit code: %EXITCODE%/);
    assert.match(text, /csrules\.ps1/);
  }
  const ps = await readFile(join(ROOT, 'csrules.ps1'));
  assert.deepEqual([...ps.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
});
