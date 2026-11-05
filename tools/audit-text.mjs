// Text-file audit: UTF-8 validity, BOM policy, U+FFFD, .bat ASCII-only.
// Usage: node tools/audit-text.mjs [rootDir]
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

const root = process.argv[2] || process.cwd();
const TEXT_EXT = new Set(['.md', '.html', '.htm', '.js', '.mjs', '.cjs', '.json', '.css', '.txt', '.bat', '.cmd', '.ps1', '.jsonl', '.csv', '.yml', '.yaml', '.svg', '.gitignore', '.gitattributes']);
const SKIP_DIR = new Set(['node_modules', '.git', 'output', 'logs', 'data', 'vendor']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const problems = [];
let count = 0;

async function walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIR.has(ent.name)) await walk(p); continue; }
    const ext = extname(ent.name).toLowerCase() || ent.name;
    if (!TEXT_EXT.has(ext)) continue;
    count++;
    const buf = await readFile(p);
    const rel = relative(root, p);
    const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    let text;
    try { text = decoder.decode(buf); } catch { problems.push(`${rel}: invalid UTF-8`); continue; }
    if (text.includes(String.fromCharCode(0xFFFD))) problems.push(`${rel}: contains U+FFFD replacement char`);
    if (ext === '.bat' || ext === '.cmd') {
      if (buf.some(b => b > 0x7F)) problems.push(`${rel}: .bat must be pure ASCII`);
    } else if (ext === '.ps1') {
      if (/[^\x00-\x7F]/.test(text) && !hasBom) problems.push(`${rel}: .ps1 with non-ASCII needs UTF-8 BOM`);
    } else if (hasBom) {
      problems.push(`${rel}: unexpected UTF-8 BOM`);
    }
  }
}

await walk(root);
console.log(`[audit] root=${root} files=${count} problems=${problems.length}`);
for (const p of problems) console.log('  - ' + p);
process.exit(problems.length ? 1 : 0);
