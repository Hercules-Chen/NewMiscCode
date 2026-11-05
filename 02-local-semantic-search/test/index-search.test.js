// End-to-end index + search using the offline "hash" embedder (fast, no model needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig, PROJECT_ROOT } from '../src/config.js';
import { nullLogger } from '../src/logger.js';
import { previewIndex, runIndex } from '../src/indexer.js';
import { Searcher } from '../src/search.js';

async function setup() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lss-test-'));
  const docs = path.join(tmp, 'docs');
  await fsp.cp(path.join(PROJECT_ROOT, 'sample-docs'), docs, { recursive: true });
  const cfg = resolveConfig({ dataDir: path.join(tmp, 'data'), dir: docs, embedder: 'hash' });
  return { tmp, docs, cfg };
}

test('dry-run lists files and writes nothing; index is incremental', async () => {
  const { tmp, docs, cfg } = await setup();
  try {
    const pv = await previewIndex(cfg, nullLogger);
    assert.ok(pv.plan.new.length >= 15);
    assert.equal(fs.existsSync(cfg.dbPath), false, 'dry-run must not create the DB');

    const s1 = await runIndex(cfg, nullLogger, { embedderName: 'hash' });
    assert.equal(s1.added, pv.plan.new.length);
    assert.equal(s1.stats.chunks, s1.stats.vectors);

    const s2 = await runIndex(cfg, nullLogger);
    assert.equal(s2.added + s2.updated, 0, 'second run re-indexes nothing');
    assert.equal(s2.unchanged, s1.added);

    // modify one file, delete another, add one
    const f = path.join(docs, 'dotnet', 'csharp-async.md');
    await fsp.appendFile(f, '\n## 新段落\nValueTask 注意事項\n');
    await fsp.rm(path.join(docs, 'journal', '2026-10-01.md'));
    await fsp.writeFile(path.join(docs, 'new-note.md'), '# 新筆記\n量子糾纏測試字串\n');
    const s3 = await runIndex(cfg, nullLogger);
    assert.equal(s3.updated, 1);
    assert.equal(s3.deleted, 1);
    assert.equal(s3.added, 1);

    const searcher = new Searcher(cfg, nullLogger);
    try {
      const r = await searcher.search('量子糾纏', { mode: 'keyword' });
      assert.equal(r.results[0].path, 'new-note.md');
      const r2 = await searcher.search('ValueTask', { mode: 'hybrid' });
      assert.equal(r2.results[0].path, 'dotnet/csharp-async.md');
      const r3 = await searcher.search('2026-10-01 牛肉麵', { mode: 'keyword' });
      assert.ok(!r3.results.some((x) => x.path === 'journal/2026-10-01.md'), 'deleted file is gone');
    } finally { searcher.close(); }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('hybrid search returns score breakdown; embedder mismatch requires --rebuild', async () => {
  const { tmp, cfg } = await setup();
  try {
    await runIndex(cfg, nullLogger, { embedderName: 'hash' });
    const searcher = new Searcher(cfg, nullLogger);
    try {
      const r = await searcher.search('Always Encrypted 憑證', { mode: 'hybrid', k: 5 });
      assert.equal(r.results[0].path, 'database/sql-always-encrypted.md');
      const sc = r.results[0].scores;
      assert.ok(sc.rrf > 0 && sc.keywordRank && sc.semanticRank && sc.bm25 !== null && sc.cosine !== null);
      assert.deepEqual(r.results[0].matchedBy.sort(), ['keyword', 'semantic']);
    } finally { searcher.close(); }
    await assert.rejects(() => runIndex(cfg, nullLogger, { embedderName: 'hash-ngram:128:v1' }), /--rebuild/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
