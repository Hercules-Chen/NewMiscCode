// Folder walker + incremental indexer (mtime/size fast path, sha256 content check).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { SUPPORTED_EXT, SKIP_DIRS, CHUNKER_VERSION } from './config.js';
import { openDb, ensureVecTable, resetIndex, hasVecTable, stats } from './db.js';
import { parseDocument } from './parse.js';
import { toFtsText } from './tokenize.js';
import { createEmbedder } from './embedder.js';

const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/** Async recursive walk; returns supported files sorted by relative path. */
export async function scanFolder(root, logger) {
  const out = [];
  async function walk(dir) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (err) { logger?.warn('scan.readdir_failed', { dir, err: err.message }); return; }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) await walk(abs); continue; }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) continue;
      const st = await fsp.stat(abs);
      out.push({ abs, rel: toRel(root, abs), ext, mtimeMs: Math.floor(st.mtimeMs), size: st.size });
    }
  }
  await walk(root);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/** Classify scanned files vs. DB rows (no writes). */
export function planChanges(files, dbRows) {
  const byPath = new Map(dbRows.map((r) => [r.path, r]));
  const plan = { new: [], changed: [], unchanged: [], deleted: [] };
  const seen = new Set();
  for (const f of files) {
    seen.add(f.rel);
    const row = byPath.get(f.rel);
    if (!row) plan.new.push(f);
    else if (row.mtime_ms !== f.mtimeMs || row.size !== f.size) plan.changed.push({ ...f, row });
    else plan.unchanged.push(f);
  }
  for (const r of dbRows) if (!seen.has(r.path)) plan.deleted.push({ rel: r.path, row: r });
  return plan;
}

/** Dry-run / preview: list what `index` would do, without creating or modifying the DB. */
export async function previewIndex(cfg, logger) {
  const root = cfg.docsDir;
  const files = await scanFolder(root, logger);
  let rows = [];
  let note = null;
  if (fs.existsSync(cfg.dbPath)) {
    const { db, getMeta } = openDb(cfg.dbPath, { logger, readonly: true });
    try {
      const storedRoot = getMeta('docs_root');
      if (storedRoot && path.resolve(storedRoot) !== path.resolve(root)) note = `DB was built for ${storedRoot}; indexing ${root} will reset it.`;
      else rows = db.prepare('SELECT path, mtime_ms, size, sha256 FROM files').all();
    } finally { db.close(); }
  }
  const plan = planChanges(files, rows);
  logger?.info('index.preview', { root, new: plan.new.length, changed: plan.changed.length, unchanged: plan.unchanged.length, deleted: plan.deleted.length });
  return { root, dbPath: cfg.dbPath, note, plan };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function embedTextFor(title, chunk) {
  const head = chunk.heading && chunk.heading !== title ? `${title} > ${chunk.heading}` : title;
  return `${head}\n${chunk.text}`;
}

/**
 * Build / update the index.
 * @param {object} cfg resolved config
 * @param {object} o { rebuild, embedderName, onProgress }
 */
export async function runIndex(cfg, logger, o = {}) {
  const t0 = performance.now();
  const root = cfg.docsDir;
  if (!fs.existsSync(root)) throw new Error(`Docs folder not found: ${root}`);
  const { db, getMeta, setMeta } = openDb(cfg.dbPath, { logger });
  const summary = { root, dbPath: cfg.dbPath, added: 0, updated: 0, touched: 0, unchanged: 0, deleted: 0, chunks: 0, embedder: null, ms: 0 };
  try {
    const storedId = getMeta('embedder_id');
    const embedder = createEmbedder(o.embedderName || storedId || cfg.embedder, cfg, logger);
    summary.embedder = embedder.id;
    let reset = !!o.rebuild;
    const storedRoot = getMeta('docs_root');
    if (storedRoot && path.resolve(storedRoot) !== path.resolve(root)) { logger.warn('index.root_changed_reset', { storedRoot, root }); reset = true; }
    if (getMeta('chunker_version') && getMeta('chunker_version') !== CHUNKER_VERSION) reset = true;
    if (db.prepare('SELECT count(*) n FROM files').get().n === 0) reset = true; // empty index: free to switch embedder
    if (storedId && storedId !== embedder.id && !reset) {
      throw new Error(`Index was built with embedder "${storedId}" but "${embedder.id}" was requested. Re-run with --rebuild.`);
    }
    if (reset) { logger.info('index.reset', { reason: o.rebuild ? 'rebuild' : 'auto' }); resetIndex(db); }

    // embedder.init() is lazy (first embedPassages call), so a no-change run never loads the model.
    ensureVecTable(db, embedder.dim);
    setMeta('embedder_id', embedder.id);
    setMeta('embedder_dim', embedder.dim);
    setMeta('chunker_version', CHUNKER_VERSION);
    setMeta('docs_root', root);

    const files = await scanFolder(root, logger);
    const rows = db.prepare('SELECT id, path, mtime_ms, size, sha256 FROM files').all();
    const plan = planChanges(files, rows);
    summary.unchanged = plan.unchanged.length;

    const delChunks = db.prepare('SELECT id FROM chunks WHERE file_id = ?');
    const delFts = db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
    const delVec = db.prepare('DELETE FROM chunks_vec WHERE rowid = ?');
    const delFile = db.prepare('DELETE FROM files WHERE id = ?');
    const removeChunksOf = (fileId) => {
      for (const { id } of delChunks.all(fileId)) { delFts.run(BigInt(id)); delVec.run(BigInt(id)); }
      db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
    };
    const upsertFile = db.prepare(`INSERT INTO files(path,title,mtime_ms,size,sha256,indexed_at) VALUES(@path,@title,@mtime,@size,@sha,@at)
      ON CONFLICT(path) DO UPDATE SET title=excluded.title, mtime_ms=excluded.mtime_ms, size=excluded.size, sha256=excluded.sha256, indexed_at=excluded.indexed_at RETURNING id`);
    const touchFile = db.prepare('UPDATE files SET mtime_ms = ?, size = ? WHERE id = ?');
    const insChunk = db.prepare('INSERT INTO chunks(file_id,ord,heading,text,line) VALUES(?,?,?,?,?)');
    const insFts = db.prepare('INSERT INTO chunks_fts(rowid,title,heading,body) VALUES(?,?,?,?)');
    const insVec = db.prepare('INSERT INTO chunks_vec(rowid,embedding) VALUES(?,?)');

    // deletions
    db.transaction(() => { for (const d of plan.deleted) { removeChunksOf(d.row.id); delFile.run(d.row.id); summary.deleted++; } })();
    for (const d of plan.deleted) logger.info('index.file_deleted', { path: d.rel });

    const work = [...plan.new, ...plan.changed];
    let i = 0;
    for (const f of work) {
      i++;
      const buf = await fsp.readFile(f.abs);
      const hash = sha256(buf);
      if (f.row && f.row.sha256 === hash) { touchFile.run(f.mtimeMs, f.size, f.row.id); summary.touched++; logger.debug('index.file_touched', { path: f.rel }); continue; }
      const content = buf.toString('utf8');
      const { title, chunks } = parseDocument(content, f.ext, path.basename(f.abs));
      const tE = performance.now();
      const vectors = chunks.length ? await embedder.embedPassages(chunks.map((c) => embedTextFor(title, c))) : [];
      const embedMs = Math.round(performance.now() - tE);
      db.transaction(() => {
        if (f.row) removeChunksOf(f.row.id);
        const { id: fileId } = upsertFile.get({ path: f.rel, title, mtime: f.mtimeMs, size: f.size, sha: hash, at: new Date().toISOString() });
        chunks.forEach((c, k) => {
          const { lastInsertRowid } = insChunk.run(fileId, c.ord, c.heading, c.text, c.line);
          const id = BigInt(lastInsertRowid);
          insFts.run(id, toFtsText(title), toFtsText(c.heading), toFtsText(c.text));
          insVec.run(id, vectors[k]);
        });
      })();
      summary.chunks += chunks.length;
      if (f.row) summary.updated++; else summary.added++;
      logger.info('index.file_indexed', { path: f.rel, chunks: chunks.length, embedMs, status: f.row ? 'changed' : 'new' });
      o.onProgress?.({ i, total: work.length, path: f.rel, chunks: chunks.length });
    }
    setMeta('last_indexed_at', new Date().toISOString());
    summary.ms = Math.round(performance.now() - t0);
    summary.stats = stats(db, getMeta);
    logger.info('index.done', summary);
    return summary;
  } finally {
    db.close();
  }
}

export { hasVecTable };
