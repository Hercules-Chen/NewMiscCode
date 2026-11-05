// SQLite storage: files + chunks tables, FTS5 keyword index, sqlite-vec vector index.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export const SCHEMA_VERSION = '1';

export function openDb(dbPath, { logger, readonly = false } = {}) {
  if (!readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { readonly, fileMustExist: readonly });
  sqliteVec.load(db);
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  const getMeta = (k) => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? null;
  const setMeta = (k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
  if (readonly) return { db, getMeta, setMeta };
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,      -- relative to docs root, '/' separators
      title TEXT,
      mtime_ms INTEGER NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      heading TEXT,
      text TEXT NOT NULL,
      line INTEGER
    );
    CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, heading, body, tokenize = 'unicode61');
  `);
  if (!getMeta('schema_version')) setMeta('schema_version', SCHEMA_VERSION);
  logger?.debug('db.open', { dbPath, sqlite: db.prepare('select sqlite_version() v').get().v, vec: db.prepare('select vec_version() v').get().v });
  return { db, getMeta, setMeta };
}

export function hasVecTable(db) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE name = 'chunks_vec'").get();
}

export function ensureVecTable(db, dim) {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[${Number(dim)}] distance_metric=cosine)`);
}

/** Drop all indexed content (used by --rebuild or when the embedder changes). */
export function resetIndex(db) {
  db.exec(`
    DELETE FROM chunks_fts;
    DELETE FROM chunks;
    DELETE FROM files;
    DROP TABLE IF EXISTS chunks_vec;
    DELETE FROM meta WHERE key IN ('embedder_id','embedder_dim','chunker_version');
  `);
}

export function stats(db, getMeta) {
  const one = (sql) => db.prepare(sql).get();
  return {
    files: one('SELECT count(*) n FROM files').n,
    chunks: one('SELECT count(*) n FROM chunks').n,
    vectors: hasVecTable(db) ? one('SELECT count(*) n FROM chunks_vec').n : 0,
    embedder: getMeta('embedder_id'),
    dim: Number(getMeta('embedder_dim')) || null,
    docsRoot: getMeta('docs_root'),
    lastIndexedAt: getMeta('last_indexed_at'),
    chunker: getMeta('chunker_version'),
  };
}
