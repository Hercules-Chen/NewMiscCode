// Real-model semantic checks (multilingual-e5-small). Skipped when the model is not downloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig, PROJECT_ROOT } from '../src/config.js';
import { nullLogger } from '../src/logger.js';
import { runIndex } from '../src/indexer.js';
import { Searcher } from '../src/search.js';
import { TransformersEmbedder } from '../src/embedder.js';

const cfg0 = resolveConfig({});
const present = new TransformersEmbedder({ modelDir: cfg0.modelDir }).localModelPresent();

test('e5: semantic search finds the Always Encrypted note without exact keywords', { skip: !present && 'model not downloaded (npm run fetch-model)' }, async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lss-e5-'));
  try {
    const cfg = resolveConfig({ dataDir: tmp, embedder: 'e5' });
    const s = await runIndex(cfg, nullLogger, { embedderName: 'e5' });
    assert.equal(s.stats.dim, 384);
    const searcher = new Searcher(cfg, nullLogger);
    try {
      const sem = await searcher.search('欄位加密連線失敗', { mode: 'semantic', k: 3 });
      assert.equal(sem.results[0].path, 'database/sql-always-encrypted.md');
      const sem2 = await searcher.search('保護個資不讓管理員看到', { mode: 'semantic', k: 3 });
      assert.equal(sem2.results[0].path, 'database/sql-always-encrypted.md');
      const kw2 = await searcher.search('保護個資不讓管理員看到', { mode: 'keyword', k: 3 });
      assert.notEqual(kw2.results[0]?.path, 'database/sql-always-encrypted.md', 'keyword alone ranks it lower (shows the value of semantic)');
      const hy = await searcher.search('欄位加密連線失敗', { mode: 'hybrid', k: 3 });
      assert.ok(hy.results.some((r) => r.path === 'database/sql-always-encrypted.md'));
    } finally { searcher.close(); }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
