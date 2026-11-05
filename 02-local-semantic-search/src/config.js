// Central configuration: OS-aware default locations + env overrides.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_VENDOR = 'NewMiscCode';
export const APP_NAME = '02-local-semantic-search';

/** Default data dir: %ProgramData%\NewMiscCode\02-local-semantic-search on Windows, ./data (project) elsewhere. */
export function defaultDataDir() {
  if (process.env.LSS_DATA_DIR) return path.resolve(process.env.LSS_DATA_DIR);
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
    return path.join(base, APP_VENDOR, APP_NAME);
  }
  return path.join(PROJECT_ROOT, 'data');
}

export function resolveConfig(opts = {}) {
  const dataDir = path.resolve(opts.dataDir || defaultDataDir());
  return {
    dataDir,
    dbPath: path.resolve(opts.db || process.env.LSS_DB || path.join(dataDir, 'index.sqlite')),
    logDir: path.resolve(opts.logDir || process.env.LSS_LOG_DIR || path.join(dataDir, 'logs')),
    modelDir: path.resolve(opts.modelDir || process.env.LSS_MODEL_DIR || path.join(PROJECT_ROOT, 'models')),
    docsDir: path.resolve(opts.dir || process.env.LSS_DOCS_DIR || path.join(PROJECT_ROOT, 'sample-docs')),
    embedder: opts.embedder || process.env.LSS_EMBEDDER || 'e5',
    allowRemoteModels: opts.allowRemote ?? (process.env.LSS_ALLOW_REMOTE === '1'),
    debug: !!opts.debug || process.env.LSS_DEBUG === '1',
    host: opts.host || process.env.LSS_HOST || '127.0.0.1',
    port: Number(opts.port || process.env.LSS_PORT || 8787),
    hostname: os.hostname(),
  };
}

export const CHUNKER_VERSION = 'heading-v1';
export const SUPPORTED_EXT = new Set(['.md', '.markdown', '.html', '.htm']);
export const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.svn']);
