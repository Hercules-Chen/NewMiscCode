// Fetch the multilingual-e5-small ONNX (int8) model into ./models/Xenova/multilingual-e5-small
// so the app runs fully offline afterwards (env.allowRemoteModels = false).
//
//   node scripts/fetch-model.js                # default: --source hf
//   node scripts/fetch-model.js --source hf    # https://huggingface.co (or $HF_ENDPOINT, e.g. https://hf-mirror.com)
//   node scripts/fetch-model.js --source npm   # npm registry package "dsh-plugin-discover-model@0.1.0"
//                                              # (third-party MIT package bundling the same Xenova files;
//                                              #  used when huggingface.co is blocked but npm is reachable)
//   node scripts/fetch-model.js --check        # only verify files + sha256
//
// Files are verified against pinned SHA-256 values (see EXPECTED below).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT } from '../src/config.js';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const NPM_PKG = 'dsh-plugin-discover-model@0.1.0';
// path inside model dir -> { sha256, bytes }
const EXPECTED = {
  'onnx/model_quantized.onnx': { sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193', bytes: 118308185 },
  'tokenizer.json': { sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39', bytes: 17082730 },
  'config.json': { sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1', bytes: 658 },
  'tokenizer_config.json': { sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b', bytes: 443 },
  'special_tokens_map.json': { sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7', bytes: 167 },
};

const { values: v } = parseArgs({ options: { source: { type: 'string', default: 'hf' }, 'model-dir': { type: 'string' }, check: { type: 'boolean' }, force: { type: 'boolean' } } });
const modelRoot = path.resolve(v['model-dir'] || process.env.LSS_MODEL_DIR || path.join(PROJECT_ROOT, 'models'));
const target = path.join(modelRoot, ...MODEL_ID.split('/'));

const sha = (file) => new Promise((res, rej) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
});

async function verify({ strict = true } = {}) {
  let ok = true;
  for (const [rel, exp] of Object.entries(EXPECTED)) {
    const f = path.join(target, rel);
    if (!fs.existsSync(f)) { console.log(`MISSING  ${rel}`); ok = false; continue; }
    const got = await sha(f);
    const match = got === exp.sha256;
    console.log(`${match ? 'OK      ' : (strict ? 'MISMATCH' : 'DIFFERS ')} ${rel} ${got.slice(0, 16)}…`);
    if (!match && strict) ok = false;
  }
  return ok;
}

async function fromHf() {
  const endpoint = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');
  for (const rel of Object.keys(EXPECTED)) {
    const url = `${endpoint}/${MODEL_ID}/resolve/main/${rel}`;
    const dest = path.join(target, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    process.stdout.write(`GET ${url} ... `);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
}

async function fromNpm() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lss-model-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    console.log(`npm pack ${NPM_PKG} (about 82 MB download, no install scripts are run) ...`);
    const out = execFileSync(npm, ['pack', NPM_PKG, '--pack-destination', tmp, '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim().split(/\r?\n/).pop();
    const tgz = path.join(tmp, out);
    execFileSync('tar', ['-xzf', tgz, '-C', tmp]); // tar.exe ships with Windows 10+
    const pkg = path.join(tmp, 'package');
    const map = { 'onnx/model_quantized.onnx': 'model_quantized.onnx' };
    for (const rel of Object.keys(EXPECTED)) {
      const src = path.join(pkg, map[rel] || rel);
      const dest = path.join(target, rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(src, dest);
      console.log(`copied ${rel}`);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

console.log(`model dir: ${target}`);
if (v.check) process.exit((await verify()) ? 0 : 1);
if (!v.force && (await verify().catch(() => false))) { console.log('Model already present and verified.'); process.exit(0); }
if (v.source === 'npm') await fromNpm();
else if (v.source === 'hf') await fromHf();
else { console.error('unknown --source (hf|npm)'); process.exit(2); }
// HF files may legitimately be re-exported upstream; npm package must match exactly.
const ok = await verify({ strict: v.source === 'npm' });
console.log(ok ? 'Model ready. Run: npm run index' : 'Verification failed.');
process.exit(ok ? 0 : 1);
