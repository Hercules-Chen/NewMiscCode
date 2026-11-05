// Bundle the browser client with esbuild -> public/dist/app.js
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();
const result = await build({
  entryPoints: [join(root, 'src/client/main.js')],
  outfile: join(root, 'public/dist/app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: !process.argv.includes('--no-minify'),
  sourcemap: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning'
});
const bytes = Object.values(result.metafile.outputs).find((o, i, arr) => arr.length && o.entryPoint)?.bytes;
console.log(`[build] public/dist/app.js ${bytes ?? '?'} bytes in ${Date.now() - started} ms`);
