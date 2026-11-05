#!/usr/bin/env node
// csrules CLI: C# team-rule checker on web-tree-sitter (WASM). No .NET SDK needed.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError, DEFAULT_CONFIG } from './config.js';
import { run, exitCodeFor, versions, TOOL, ALL_RULE_IDS, loadLanguage } from './engine.js';
import { createLogger, defaultLogDir } from './logger.js';
import { formatConsole } from './reporters/console.js';
import { toSarif } from './reporters/sarif.js';
import { toHtml } from './reporters/html.js';

const HELP = {
  'zh-TW': `用法：node src/cli.js [選項] <檔案或資料夾...>

選項：
  --config <檔案>          指定 csrules.json（預設：第一個目標資料夾或目前資料夾中的 csrules.json）
  --rules R1,R3            只執行指定規則
  --lang zh-TW|en          訊息語言（預設取自設定檔 language，否則 zh-TW）
  --format console|json    標準輸出格式（預設 console）
  --json <檔案>            另存 JSON 結果
  --sarif <檔案>           另存 SARIF 2.1.0（GitHub code scanning / VS Code SARIF Viewer）
  --html <檔案>            另存自帶 HTML 報告（繁中 / 英文切換）
  --fix-suggestions        在主控台列出建議改寫（不會修改檔案）
  --fail-on error|warning|none  何種嚴重度導致結束碼 1（預設 error）
  --debug                  輸出比對到的語法節點 / query captures（stderr 與日誌）
  --log-dir <資料夾>       JSONL 日誌資料夾（Windows 預設 %ProgramData%\\NewMiscCode\\11-csharp-rules-treesitter，Linux ./logs）
  --log-level debug|info|warn|error|off
  --print-config           印出合併後的設定
  --init                   在目前資料夾寫出預設 csrules.json
  --version                顯示版本（含 web-tree-sitter 與文法版本、ABI）
  --no-color               不使用 ANSI 顏色

結束碼：0 = 通過；1 = 有達到 --fail-on 等級的問題；2 = 參數或設定錯誤；3 = 內部錯誤（例如 wasm 載入失敗）`,
  en: `Usage: node src/cli.js [options] <file-or-dir...>

Options:
  --config <file>          csrules.json path (default: csrules.json in the first target dir or cwd)
  --rules R1,R3            run only these rules
  --lang zh-TW|en          message language (default: config "language", else zh-TW)
  --format console|json    stdout format (default console)
  --json <file>            also write JSON results
  --sarif <file>           also write SARIF 2.1.0
  --html <file>            also write a self-contained HTML report
  --fix-suggestions        print suggested rewrites (no files are modified)
  --fail-on error|warning|none  severity that makes the exit code 1 (default error)
  --debug                  dump matched syntax nodes / query captures (stderr + log)
  --log-dir <dir>          JSONL log dir (Windows default %ProgramData%\\NewMiscCode\\11-csharp-rules-treesitter, Linux ./logs)
  --log-level debug|info|warn|error|off
  --print-config           print the merged configuration
  --init                   write a default csrules.json into the current directory
  --version                print versions (web-tree-sitter, grammar, ABI)
  --no-color               disable ANSI colours

Exit codes: 0 = clean; 1 = findings at/above --fail-on; 2 = usage/config error; 3 = internal error (e.g. wasm load failure)`,
};

const VALUE_OPTS = new Set(['--config', '--rules', '--lang', '--format', '--json', '--sarif', '--html', '--fail-on', '--log-dir', '--log-level']);
const FLAG_OPTS = new Set(['--fix-suggestions', '--debug', '--print-config', '--init', '--version', '--help', '-h', '--no-color']);

class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_OPTS.has(a)) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--') && a.includes('=') && VALUE_OPTS.has(a.split('=')[0])) {
      opts[a.split('=')[0].slice(2)] = a.slice(a.indexOf('=') + 1);
    } else if (FLAG_OPTS.has(a)) opts[a.replace(/^-+/, '')] = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else opts.targets.push(a);
  }
  if (opts.format && !['console', 'json'].includes(opts.format)) throw new UsageError('--format must be console or json');
  if (opts['fail-on'] && !['error', 'warning', 'none'].includes(opts['fail-on'])) throw new UsageError('--fail-on must be error, warning or none');
  if (opts.lang && !['zh-TW', 'en'].includes(opts.lang)) throw new UsageError('--lang must be zh-TW or en');
  if (opts.rules) {
    opts.rules = opts.rules.split(/[,\s]+/).filter(Boolean).map(s => s.toUpperCase());
    const bad = opts.rules.filter(r => !ALL_RULE_IDS.includes(r));
    if (bad.length) throw new UsageError(`unknown rule(s): ${bad.join(', ')}`);
  }
  return opts;
}

async function writeOut(file, content) {
  await mkdir(dirname(resolve(file)), { recursive: true });
  await writeFile(file, content, 'utf8');
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  const envLang = /^zh/i.test(process.env.CSRULES_LANG || '') ? 'zh-TW' : (process.env.CSRULES_LANG ? 'en' : null);
  try { opts = parseArgs(argv); } catch (e) {
    process.stderr.write(`csrules: ${e.message}\n\n${HELP[envLang || 'zh-TW']}\n`);
    return 2;
  }
  if (opts.help || opts.h) { process.stdout.write(HELP[opts.lang || envLang || 'zh-TW'] + '\n'); return 0; }
  if (opts.init) {
    await writeOut('csrules.json', JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    process.stdout.write(`csrules.json written: ${resolve('csrules.json')}\n`);
    return 0;
  }
  if (opts.version) {
    const { lang, wasm } = await loadLanguage();
    process.stdout.write(JSON.stringify({ [TOOL.name]: TOOL.version, ...versions(), grammarAbi: lang.abiVersion, grammarWasm: wasm }, null, 2) + '\n');
    return 0;
  }

  let loaded;
  try {
    loaded = await loadConfig({ configPath: opts.config, searchDirs: opts.targets.slice(0, 1) });
  } catch (e) {
    if (e instanceof ConfigError) { process.stderr.write(`csrules: config error: ${e.message}\n`); return 2; }
    throw e;
  }
  const { config } = loaded;
  const lang = opts.lang || envLang || config.language || 'zh-TW';
  if (opts['print-config']) { process.stdout.write(JSON.stringify({ file: loaded.file, ...config }, null, 2) + '\n'); return 0; }
  if (!opts.targets.length) { process.stderr.write(`csrules: no targets given\n\n${HELP[lang]}\n`); return 2; }

  const logger = await createLogger({ dir: opts['log-dir'] || defaultLogDir(), level: opts['log-level'] || (opts.debug ? 'debug' : 'info') });
  if (logger.failure) process.stderr.write(`csrules: logging disabled (${logger.failure.message})\n`);
  logger.info('start', { argv, cwd: process.cwd(), config: loaded.file, lang });
  const onDebug = o => process.stderr.write('[debug] ' + JSON.stringify(o) + '\n');

  let result;
  try {
    result = await run({ targets: opts.targets, config, debug: !!opts.debug, logger, onDebug, only: opts.rules || null });
  } catch (e) {
    if (e.code === 'ENOENT') { process.stderr.write(`csrules: target not found: ${e.path}\n`); await logger.flush(); return 2; }
    logger.error('fatal', { error: e.stack });
    await logger.flush();
    process.stderr.write(`csrules: internal error: ${e.stack}\n`);
    return 3;
  }

  if (opts.json) await writeOut(opts.json, JSON.stringify(result, null, 2) + '\n');
  if (opts.sarif) await writeOut(opts.sarif, JSON.stringify(toSarif(result, { baseDir: opts.targets[0] && !/\.cs$/i.test(opts.targets[0]) ? opts.targets[0] : process.cwd() }), null, 2) + '\n');
  if (opts.html) await writeOut(opts.html, toHtml(result, { lang }));
  if (opts.format === 'json') process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write(formatConsole(result, { lang, color: !opts['no-color'] && process.stdout.isTTY, fixSuggestions: !!opts['fix-suggestions'] }) + '\n');
  for (const fe of result.fileErrors) process.stderr.write(`csrules: failed to check ${fe.file}: ${fe.error}\n`);
  if (opts.debug && logger.file) process.stderr.write(`[debug] log file: ${logger.file}\n`);

  const code = exitCodeFor(result, opts['fail-on'] || 'error');
  logger.info('exit', { code });
  await logger.flush();
  return code;
}

const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p);
const isMain = process.argv[1] && norm(resolve(process.argv[1])) === norm(fileURLToPath(import.meta.url));
if (isMain) {
  main().then(code => { process.exitCode = code; }, e => { process.stderr.write(`csrules: ${e.stack}\n`); process.exitCode = 3; });
}
