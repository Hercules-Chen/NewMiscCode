// 一鍵示範：啟動 v1/v2 → 經代理錄製 → 重播到 v2 → 產生 diff 與 replay 報告。
// One-shot demo: start v1/v2, record via proxy, replay to v2, write diff + replay reports.
// Usage: node scripts/demo.js [--out-dir dir] [--lang en]
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { startOldApi } from '../demo/old-api/server.js';
import { startNewApi } from '../demo/new-api/server.js';
import { sendDemoTraffic } from '../demo/traffic.js';
import { startRecorder } from '../src/traffic/proxy.js';
import { main } from '../src/cli.js';
import { defaultDataDir, PROJECT_ROOT, Logger } from '../src/env.js';
import { parseArgs } from '../src/cli.js';

const { opt } = parseArgs(process.argv.slice(2));
const lang = opt.lang === 'en' ? 'en' : 'zh-TW';
const dataDir = resolve(opt['data-dir'] || defaultDataDir());
const outDir = resolve(opt['out-dir'] || join(dataDir, 'demo'));
await mkdir(outDir, { recursive: true });
const cfg = join(PROJECT_ROOT, 'demo', 'apiguard.config.json');
const logger = new Logger({ dir: join(dataDir, 'logs'), level: opt.debug ? 'debug' : 'info' });

const oldApi = await startOldApi(0);
const newApi = await startNewApi(0);
const recFile = join(outDir, 'recordings.jsonl');
await import('node:fs/promises').then(f => f.rm(recFile, { force: true }));
const rec = await startRecorder({ target: oldApi.url, port: 0, out: recFile, logger, redact: undefined });
console.log(`[demo] old=${oldApi.url} new=${newApi.url} proxy=http://127.0.0.1:${rec.port}`);
for (const r of await sendDemoTraffic(`http://127.0.0.1:${rec.port}`)) console.log(`[demo] record ${r.method} ${r.path} -> ${r.status}`);
await rec.close();
console.log(`[demo] recorded ${rec.count()} exchanges -> ${recFile}`);

process.env.APIGUARD_REPLAY_TOKEN = process.env.APIGUARD_REPLAY_TOKEN || 'demo-replay-token';
const common = ['--config', cfg, '--lang', lang, '--data-dir', dataDir];
const codes = {};
codes.diff = await main(['diff', join(PROJECT_ROOT, 'demo/openapi-v1.yaml'), join(PROJECT_ROOT, 'demo/openapi-v2.yaml'), '--out', join(outDir, 'diff-report.html'), ...common]);
await main(['diff', join(PROJECT_ROOT, 'demo/openapi-v1.yaml'), join(PROJECT_ROOT, 'demo/openapi-v2.yaml'), '--out', join(outDir, 'diff-report.md'), ...common]);
codes.replay = await main(['replay', recFile, '--to', newApi.url, '--out', join(outDir, 'replay-report.html'), ...common]);
await main(['replay', recFile, '--to', newApi.url, '--out', join(outDir, 'replay-report.json'), ...common]);
await oldApi.close();
await newApi.close();
await logger.flush();
console.log(`[demo] exit codes: diff=${codes.diff} replay=${codes.replay} (1 = breaking changes found, expected)`);
console.log(`[demo] reports in ${outDir}`);
