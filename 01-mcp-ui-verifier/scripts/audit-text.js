#!/usr/bin/env node
// Text-file audit: UTF-8 validity, BOM rules, no U+FFFD, .bat pure ASCII.
// Rules:
//   - every text file must be valid UTF-8 and contain no U+FFFD replacement character
//   - .ps1 files containing non-ASCII must start with a UTF-8 BOM
//   - every other text file must NOT start with a BOM
//   - .bat / .cmd files must be pure ASCII
// Usage: node scripts/audit-text.js [dir]   (default: project root). Exit 1 on any problem.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const SKIP_DIRS = new Set(['node_modules', 'output', '.git']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.htm', '.css', '.txt', '.bat', '.cmd', '.ps1', '.gitignore', '.jsonl', '.yml', '.yaml', '.svg']);

async function* walk(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase() || e.name.toLowerCase();
      if (TEXT_EXT.has(ext)) yield path.join(dir, e.name);
    }
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const problems = [];
let count = 0;
for await (const file of walk(ROOT)) {
  count++;
  const rel = path.relative(ROOT, file);
  const buf = await fsp.readFile(file);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let text;
  try {
    text = decoder.decode(buf);
  } catch {
    problems.push(`${rel}: invalid UTF-8`);
    continue;
  }
  if (text.includes(String.fromCharCode(0xfffd))) problems.push(`${rel}: contains U+FFFD replacement character`);
  const nonAscii = /[^\x00-\x7f]/.test(hasBom ? text.slice(1) : text);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.bat' || ext === '.cmd') {
    if (hasBom || nonAscii) problems.push(`${rel}: .bat/.cmd must be pure ASCII (no BOM, no non-ASCII)`);
  } else if (ext === '.ps1') {
    if (nonAscii && !hasBom) problems.push(`${rel}: .ps1 with non-ASCII text must be UTF-8 WITH BOM`);
  } else if (hasBom) {
    problems.push(`${rel}: must be UTF-8 without BOM`);
  }
}

if (problems.length) {
  console.error(`Text audit FAILED (${problems.length} problem(s) in ${count} files):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`Text audit OK: ${count} text files checked under ${ROOT} (UTF-8 valid, BOM rules, no U+FFFD, .bat ASCII).`);
