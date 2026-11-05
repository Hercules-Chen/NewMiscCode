// CLI verification: scan testdata (expected violations), dry-run --fix must not
// write, --fix --apply on a temp copy, then re-scan must report 0 errors / 0 fixable.
// Usage: node test/cli.mjs   (run "npm run build" first)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(HERE, 'bin', process.platform === 'win32' ? 'encdoc.exe' : 'encdoc');
if (!existsSync(BIN)) { console.error('missing ' + BIN + ' (run: npm run build)'); process.exit(2); }
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

function run(args) {
  try { return { code: 0, out: execFileSync(BIN, args, { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: e.stdout }; }
}
const hashDir = d => Object.fromEntries(readdirSync(d).map(f => [f, createHash('sha256').update(readFileSync(join(d, f))).digest('hex')]));

// 1. scan the corpus
const scan = run(['--json', join(HERE, 'testdata')]);
const res = JSON.parse(scan.out);
const byName = Object.fromEntries(res.files.map(f => [f.path.split('/').pop(), f.report]));
const codes = n => byName[n].issues.map(i => i.code);
check(scan.code === 1, `scan exits 1 when errors exist (got ${scan.code})`);
const expect = {
  'big5-notes.txt': ['big5', ['legacy-encoding']],
  'big5-readme.md': ['big5', ['not-utf8']],
  'gbk-simplified.txt': ['gbk', ['legacy-encoding']],
  'sjis-japanese.txt': ['shift_jis', ['legacy-encoding']],
  'bom-readme.md': ['utf-8', ['utf8-bom-unexpected']],
  'chinese-echo.bat': ['utf-8', ['bat-non-ascii', 'bat-eol']],
  'bom.cmd': ['utf-8', ['bat-bom']],
  'no-bom.ps1': ['utf-8', ['ps1-bom-missing']],
  'big5-ansi.ps1': ['big5', ['ps1-bom-missing']],
  'mixed-eol.js': ['utf-8', ['mixed-eol']],
  'crlf.sh': ['ascii', ['sh-eol']],
  'mojibake-latin1.md': ['utf-8', ['mojibake']],
  'mojibake-cp950.txt': ['utf-8', ['mojibake', 'replacement-char']],
  'lost-fffd.txt': ['utf-8', ['replacement-char']],
  'nul-bytes.txt': ['ascii', ['nul-bytes']],
  'good.md': ['utf-8', []], 'good.json': ['utf-8', []], 'good.bat': ['ascii', []], 'good.ps1': ['utf-8', []], 'utf16le-bom.txt': ['utf-16le', []]
};
for (const [name, [enc, want]] of Object.entries(expect)) {
  const r = byName[name];
  check(r && r.encoding === enc && JSON.stringify(codes(name)) === JSON.stringify(want), `${name}: ${enc} [${want.join(',')}] (got ${r && r.encoding} [${r && codes(name).join(',')}])`);
}
console.log(`      summary: ${JSON.stringify(res.summary)}`);

// 2. dry run must not touch files
const tmp = mkdtempSync(join(tmpdir(), 'encdoc-cli-'));
cpSync(join(HERE, 'testdata'), tmp, { recursive: true });
const before = hashDir(tmp);
const dry = run(['--fix', '--lang', 'en', tmp]);
check(/dry run: \d+ files would change/.test(dry.out), 'dry run prints the plan');
check(JSON.stringify(hashDir(tmp)) === JSON.stringify(before), 'dry run leaves files untouched');

// 3. apply + rescan
const apply = run(['--fix', '--apply', '--force-ascii', '--allow-lossy', '--json', tmp]);
const applied = JSON.parse(apply.out);
check(applied.summary.written === 13, `--apply wrote ${applied.summary.written} files`);
check(existsSync(join(tmp, 'no-bom.ps1.bak')), 'original kept as .bak');
const re = JSON.parse(run(['--json', tmp]).out);
check(re.summary.errors === 0 && re.summary.fixable === 0, `re-scan clean: errors=${re.summary.errors} fixable=${re.summary.fixable} warnings=${re.summary.warnings}`);
const leftovers = re.files.flatMap(f => f.report.issues.map(i => f.path.split('/').pop() + ':' + i.code));
check(leftovers.every(x => /:(replacement-char|nul-bytes)$/.test(x)), `only manual warnings remain: ${leftovers.join(', ')}`);
const ps1 = readFileSync(join(tmp, 'no-bom.ps1'));
check(ps1[0] === 0xEF && ps1[1] === 0xBB && ps1[2] === 0xBF, 'no-bom.ps1 now starts with EF BB BF');
const bat = readFileSync(join(tmp, 'chinese-echo.bat'));
check(bat.every(b => b < 0x80) && bat.toString().split('\r\n').length === 5, 'chinese-echo.bat is ASCII + CRLF');
check(readFileSync(join(tmp, 'big5-readme.md'), 'utf8').includes('說明文件'), 'big5-readme.md converted to UTF-8');

// 4. convert subcommand
const conv = run(['convert', '--from', 'big5', '--to', 'utf-8', '--bom', '--eol', 'lf', join(HERE, 'testdata', 'big5-notes.txt'), join(tmp, 'out.txt')]);
const out = readFileSync(join(tmp, 'out.txt'));
check(conv.code === 0 && out[0] === 0xEF && out.toString('utf8').includes('編碼醫生') && !out.includes(0x0d), 'convert big5 -> utf-8 + BOM + LF');
rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall CLI checks passed');
process.exit(failures ? 1 : 0);
