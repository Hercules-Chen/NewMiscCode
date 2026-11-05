// Bundle client/main.js + @simplewebauthn/browser into public/build/app.js (no CDN at runtime).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [join(root, 'client/main.js')],
  outfile: join(root, 'public/build/app.js'),
  bundle: true, format: 'iife', target: ['chrome109', 'edge109', 'firefox115', 'safari16'],
  sourcemap: true, minify: false, charset: 'utf8', legalComments: 'inline', logLevel: 'info',
});
