// Runs a fixed set of demo queries in keyword / semantic / hybrid mode and prints the top 3
// of each, so keyword-vs-semantic differences are easy to compare. Requires a built index.
// Usage: node scripts/demo-queries.js [--k 3]
import { resolveConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { Searcher } from '../src/search.js';

const QUERIES = [
  '欄位加密連線失敗',
  '保護個資不讓管理員看到',
  '桌面程式打包後讀不到 C++ 擴充',
  '批次檔中文變成亂碼',
  'UI hangs when waiting for a task',
  'server runs out of ports under load',
];
const k = Number(process.argv[process.argv.indexOf('--k') + 1]) || 3;
const cfg = resolveConfig({});
const logger = new Logger({ logDir: cfg.logDir, consoleLevel: 'warn' });
const s = new Searcher(cfg, logger);
try {
  const st = s.stats();
  console.log(`# demo queries  embedder=${st.embedder}  files=${st.files} chunks=${st.chunks}  ${new Date().toISOString()}`);
  for (const q of QUERIES) {
    console.log(`\n## ${q}`);
    for (const mode of ['keyword', 'semantic', 'hybrid']) {
      const r = await s.search(q, { mode, k });
      const line = r.results.map((x) => {
        const sc = mode === 'keyword' ? `bm25=${x.scores.bm25}` : mode === 'semantic' ? `cos=${x.scores.cosine}` : `rrf=${x.scores.rrf}`;
        return `${x.rank}. ${x.path} (${sc})`;
      }).join('  |  ');
      console.log(`  ${mode.padEnd(8)} ${line || '(no results)'}`);
    }
  }
} finally {
  s.close();
  await logger.close();
}
