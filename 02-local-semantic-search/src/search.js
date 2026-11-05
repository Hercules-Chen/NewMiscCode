// Hybrid search: FTS5/BM25 keyword ranking + sqlite-vec KNN, fused with Reciprocal Rank Fusion.
import fs from 'node:fs';
import { openDb, hasVecTable, stats } from './db.js';
import { toFtsQuery, makeSnippet } from './tokenize.js';
import { createEmbedder } from './embedder.js';

export const RRF_K = 60;

/** Pure RRF: lists = [{ name, ids: [chunkId...] (best first), weight }] -> Map id -> { rrf, ranks } */
export function reciprocalRankFusion(lists, k = RRF_K) {
  const fused = new Map();
  for (const { name, ids, weight = 1 } of lists) {
    ids.forEach((id, idx) => {
      const e = fused.get(id) || { rrf: 0, ranks: {} };
      e.rrf += weight / (k + idx + 1);
      e.ranks[name] = idx + 1;
      fused.set(id, e);
    });
  }
  return fused;
}

export class Searcher {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.logger = logger;
    this.db = null;
    this.embedder = null;
  }

  open() {
    if (this.db) return;
    if (!fs.existsSync(this.cfg.dbPath)) throw new Error(`Index not found at ${this.cfg.dbPath}. Run "index" first.`);
    const { db, getMeta } = openDb(this.cfg.dbPath, { logger: this.logger, readonly: true });
    this.db = db;
    this.getMeta = getMeta;
  }

  close() { this.db?.close(); this.db = null; }

  stats() { this.open(); return stats(this.db, this.getMeta); }

  async getEmbedder() {
    if (!this.embedder) {
      const id = this.getMeta('embedder_id');
      if (!id) throw new Error('Index has no embedder metadata; re-run index.');
      this.embedder = createEmbedder(id, this.cfg, this.logger);
      await this.embedder.init();
    }
    return this.embedder;
  }

  keyword(query, limit) {
    const fts = toFtsQuery(query);
    if (!fts) return { fts, rows: [] };
    // bm25(): lower is better. Column weights: title 3, heading 2, body 1.
    const rows = this.db.prepare(
      'SELECT rowid AS id, bm25(chunks_fts, 3.0, 2.0, 1.0) AS bm25 FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25 LIMIT ?'
    ).all(fts, limit);
    return { fts, rows };
  }

  async semantic(query, limit) {
    if (!hasVecTable(this.db)) return { rows: [], embedMs: 0 };
    const emb = await this.getEmbedder();
    const t0 = performance.now();
    const qv = await emb.embedQuery(query);
    const embedMs = Math.round(performance.now() - t0);
    const rows = this.db.prepare('SELECT rowid AS id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ?').all(qv, limit);
    return { rows: rows.map((r) => ({ id: Number(r.id), cos: 1 - r.distance })), embedMs };
  }

  /**
   * @param {string} query
   * @param {{ mode?: 'hybrid'|'keyword'|'semantic', k?: number, candidates?: number, perFile?: number, wKeyword?: number, wSemantic?: number }} o
   */
  async search(query, o = {}) {
    this.open();
    const mode = o.mode || 'hybrid';
    const k = Math.max(1, Math.min(100, Number(o.k) || 10));
    const candidates = Math.max(k, Number(o.candidates) || 50);
    const perFile = o.perFile ?? 1;
    const t0 = performance.now();
    const debug = { mode, rrfK: RRF_K, candidates };

    let kw = { fts: null, rows: [] };
    let sem = { rows: [], embedMs: 0 };
    const tK = performance.now();
    if (mode !== 'semantic') kw = this.keyword(query, candidates);
    debug.ftsMs = Math.round(performance.now() - tK);
    debug.ftsQuery = kw.fts;
    const tS = performance.now();
    if (mode !== 'keyword') sem = await this.semantic(query, candidates);
    debug.vecMs = Math.round(performance.now() - tS) - sem.embedMs;
    debug.embedMs = sem.embedMs;
    debug.keywordHits = kw.rows.length;
    debug.semanticHits = sem.rows.length;

    const fused = reciprocalRankFusion([
      { name: 'keyword', ids: kw.rows.map((r) => Number(r.id)), weight: o.wKeyword ?? 1 },
      { name: 'semantic', ids: sem.rows.map((r) => r.id), weight: o.wSemantic ?? 1 },
    ]);
    const bm25By = new Map(kw.rows.map((r) => [Number(r.id), r.bm25]));
    const cosBy = new Map(sem.rows.map((r) => [r.id, r.cos]));
    // Sort by RRF; break exact ties by cosine similarity, then by BM25.
    const ordered = [...fused.entries()].sort((a, b) => (b[1].rrf - a[1].rrf)
      || ((cosBy.get(b[0]) ?? -1) - (cosBy.get(a[0]) ?? -1))
      || ((bm25By.get(a[0]) ?? 0) - (bm25By.get(b[0]) ?? 0)));

    const getChunk = this.db.prepare(`SELECT c.id, c.heading, c.text, c.line, c.ord, f.path, f.title
      FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.id = ?`);
    const perFileCount = new Map();
    const results = [];
    for (const [id, f] of ordered) {
      const c = getChunk.get(id);
      if (!c) continue;
      const n = perFileCount.get(c.path) || 0;
      if (perFile > 0 && n >= perFile) continue;
      perFileCount.set(c.path, n + 1);
      const snippet = makeSnippet(c.text, query);
      results.push({
        rank: results.length + 1,
        chunkId: id,
        path: c.path,
        title: c.title,
        heading: c.heading,
        line: c.line,
        snippet: snippet.html,
        snippetText: snippet.text,
        matchedBy: Object.keys(f.ranks),
        scores: {
          rrf: Number(f.rrf.toFixed(5)),
          keywordRank: f.ranks.keyword ?? null,
          bm25: bm25By.has(id) ? Number(bm25By.get(id).toFixed(4)) : null,
          semanticRank: f.ranks.semantic ?? null,
          cosine: cosBy.has(id) ? Number(cosBy.get(id).toFixed(4)) : null,
        },
      });
      if (results.length >= k) break;
    }
    debug.totalMs = Math.round(performance.now() - t0);
    this.logger?.info('search', { q: query, mode, k, results: results.length, ...debug });
    return { query, mode, results, debug };
  }
}
