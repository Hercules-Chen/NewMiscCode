// Renders real CLI output (node src/cli.js samples ...) as a terminal-like image for the docs.
// Usage: node scripts/screenshot-console.mjs   -> examples/console-output.png
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const args = ['src/cli.js', 'samples/SampleApp/Violations/R1_SyncOverAsync.cs', 'samples/SampleApp/Violations/R4_ResourceMisuse.cs', '--fix-suggestions', '--log-level', 'off'];
const out = await new Promise((res, rej) => {
  const p = spawn(process.execPath, args, { cwd: ROOT });
  let s = '';
  p.stdout.on('data', d => { s += d; });
  p.on('error', rej);
  p.on('close', code => res({ s, code }));
});
const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const body = esc(`$ node ${args.slice(0, 4).join(' ')}\n${out.s.split('\n').slice(0, 24).join('\n')}\n...\n$ echo $?\n${out.code}`)
  .replace(/: error (R\d)/g, ': <b class="e">error</b> <b>$1</b>').replace(/: warning (R\d)/g, ': <b class="w">warning</b> <b>$1</b>');
const html = `<!DOCTYPE html><meta charset="utf-8"><style>body{margin:0;background:#1e1e1e}pre{margin:0;padding:14px;color:#ddd;font:13px/1.45 "Noto Sans Mono CJK TC",Consolas,monospace;white-space:pre-wrap}.e{color:#f14c4c}.w{color:#cca700}</style><pre>${body}</pre>`;
await mkdir(join(ROOT, 'output'), { recursive: true });
const file = join(ROOT, 'output', 'console.html');
await writeFile(file, html, 'utf8');
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 400 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(file).href);
await page.screenshot({ path: join(ROOT, 'examples', 'console-output.png'), fullPage: true });
await browser.close();
console.log('examples/console-output.png written');
