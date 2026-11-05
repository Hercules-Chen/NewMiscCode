// Text-file audit: every text file in this project must be valid UTF-8, contain no U+FFFD,
// and have no BOM - except *.ps1 (Windows PowerShell 5.1 needs a BOM to read Chinese text)
// and *.bat, which must be pure ASCII.
// Usage: node scripts/audit-text.mjs [dir]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'logs', 'test-output']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.txt', '.csv', '.jsonl', '.bat', '.ps1', '.sh', '.gitignore', '.svg']);

async function* walk(dir) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) yield* walk(p); }
    else yield p;
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });
let bad = 0;
let count = 0;
for await (const file of walk(ROOT)) {
  const ext = path.extname(file).toLowerCase() || path.basename(file);
  if (!TEXT_EXT.has(ext)) continue;
  count++;
  const rel = path.relative(ROOT, file);
  const buf = await fs.readFile(file);
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const problems = [];
  let text = '';
  try { text = decoder.decode(buf); } catch { problems.push('invalid UTF-8'); }
  if (text.includes(String.fromCharCode(0xFFFD))) problems.push('contains U+FFFD');
  if (ext === '.ps1') {
    if (/[^\x00-\x7F]/.test(text.replace(/^\uFEFF/, '')) && !hasBom) problems.push('.ps1 with non-ASCII must have UTF-8 BOM');
  } else if (hasBom) problems.push('has BOM');
  if (ext === '.bat' && /[^\x00-\x7F]/.test(text)) problems.push('.bat must be pure ASCII');
  if (problems.length) { bad++; console.log('FAIL', rel, '-', problems.join(', ')); }
}
console.log(`[audit-text] ${count} text files checked under ${ROOT}: ${bad ? bad + ' problem(s)' : 'all OK'}`);
process.exit(bad ? 1 : 0);
