// Pluggable embedders.
//   interface Embedder {
//     id: string;            // stored in DB meta; changing it requires --rebuild
//     dim: number;
//     init(): Promise<void>;
//     embedPassages(texts: string[]): Promise<Float32Array[]>;
//     embedQuery(text: string): Promise<Float32Array>;
//   }
// e5   : intfloat/multilingual-e5-small (ONNX int8, via @huggingface/transformers on CPU)
// hash : offline fallback, hashed character n-gram TF vectors (no model download, weak semantics)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalize } from './tokenize.js';

export const E5_MODEL_ID = 'Xenova/multilingual-e5-small';

export class TransformersEmbedder {
  constructor({ modelDir, modelId = E5_MODEL_ID, dtype = 'q8', allowRemote = false, logger, batchSize = 16 } = {}) {
    this.modelId = modelId;
    this.modelDir = modelDir;
    this.dtype = dtype;
    this.allowRemote = allowRemote;
    this.logger = logger;
    this.batchSize = batchSize;
    this.id = `transformers:${modelId}:${dtype}`;
    this.dim = 384;
    this.pipe = null;
  }

  localModelPresent() {
    const base = path.join(this.modelDir, ...this.modelId.split('/'));
    return fs.existsSync(path.join(base, 'tokenizer.json')) && fs.existsSync(path.join(base, 'onnx', 'model_quantized.onnx'));
  }

  async init() {
    if (this.pipe) return;
    const t0 = performance.now();
    const { pipeline, env } = await import('@huggingface/transformers');
    env.localModelPath = this.modelDir.endsWith(path.sep) ? this.modelDir : this.modelDir + path.sep;
    env.allowLocalModels = true;
    env.allowRemoteModels = this.allowRemote;
    env.cacheDir = path.join(this.modelDir, '.cache');
    if (!this.localModelPresent() && !this.allowRemote) {
      throw new Error(`Model ${this.modelId} not found under ${this.modelDir}. Run "npm run fetch-model" (see README.html#model) or use --embedder hash.`);
    }
    this.pipe = await pipeline('feature-extraction', this.modelId, { dtype: this.dtype, device: 'cpu' });
    this.logger?.info('embedder.loaded', { id: this.id, ms: Math.round(performance.now() - t0), modelDir: this.modelDir });
  }

  async #embed(texts) {
    await this.init();
    const out = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const t0 = performance.now();
      const tensor = await this.pipe(batch, { pooling: 'mean', normalize: true });
      const data = tensor.data;
      for (let j = 0; j < batch.length; j++) out.push(Float32Array.from(data.subarray(j * this.dim, (j + 1) * this.dim)));
      this.logger?.debug('embedder.batch', { n: batch.length, ms: Math.round(performance.now() - t0) });
    }
    return out;
  }

  // e5 models are trained with "query: " / "passage: " prefixes.
  embedPassages(texts) { return this.#embed(texts.map((t) => 'passage: ' + t)); }
  async embedQuery(text) { return (await this.#embed(['query: ' + text]))[0]; }
}

/**
 * Offline fallback: feature hashing of character 1-3 grams (CJK) and word unigrams (latin),
 * log-scaled TF, L2-normalised. Captures lexical overlap only (no real synonyms), but lets the
 * whole vector pipeline run without any model files.
 */
export class HashEmbedder {
  constructor({ dim = 256 } = {}) { this.dim = dim; this.id = `hash-ngram:${dim}:v1`; }
  async init() {}
  #vec(text) {
    const v = new Float32Array(this.dim);
    const s = normalize(text);
    const feats = [];
    for (const m of s.matchAll(/[\p{L}\p{N}_]+/gu)) {
      const w = m[0];
      const chars = Array.from(w);
      if (/^[\x00-\x7f]+$/.test(w)) { feats.push('w:' + w); if (w.length > 4) for (let i = 0; i + 4 <= w.length; i++) feats.push('c4:' + w.slice(i, i + 4)); continue; }
      for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= chars.length; i++) feats.push(`g${n}:` + chars.slice(i, i + n).join(''));
    }
    const tf = new Map();
    for (const f of feats) tf.set(f, (tf.get(f) || 0) + 1);
    for (const [f, c] of tf) {
      const h = crypto.createHash('md5').update(f).digest();
      const idx = h.readUInt32LE(0) % this.dim;
      const sign = h[4] & 1 ? 1 : -1;
      const w = f.startsWith('g1:') ? 0.5 : 1;
      v[idx] += sign * w * (1 + Math.log(c));
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }
  async embedPassages(texts) { return texts.map((t) => this.#vec(t)); }
  async embedQuery(text) { return this.#vec(text); }
}

/** Factory. name: 'e5' | 'hash' | stored id from DB meta. */
export function createEmbedder(name, cfg = {}, logger) {
  if (!name || name === 'e5' || name.startsWith('transformers:')) {
    const modelId = name && name.startsWith('transformers:') ? name.split(':')[1] : E5_MODEL_ID;
    return new TransformersEmbedder({ modelDir: cfg.modelDir, modelId, allowRemote: cfg.allowRemoteModels, logger });
  }
  if (name === 'hash' || name.startsWith('hash-ngram:')) {
    const dim = name.startsWith('hash-ngram:') ? Number(name.split(':')[1]) : 256;
    return new HashEmbedder({ dim });
  }
  throw new Error(`Unknown embedder "${name}" (use e5 or hash)`);
}
