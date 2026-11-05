// Core engine: loads web-tree-sitter + the C# grammar wasm, runs per-rule queries, applies
// allowlists and inline suppressions, and returns findings. No .NET SDK involved.
import { readFile, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Parser, Language, Query } from 'web-tree-sitter';
import { message } from './i18n.js';
import { matchAny, matchName, toPosix } from './glob.js';
import { enclosingContext, pos } from './rules/util.js';
import { checkEncoding, isEncodingTarget } from './rules/r6-encoding.js';
import R1 from './rules/r1.js';
import R2 from './rules/r2.js';
import R3 from './rules/r3.js';
import R4 from './rules/r4.js';
import R5 from './rules/r5.js';

export const AST_RULES = [R1, R2, R3, R4, R5];
export const ALL_RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export const TOOL = { name: 'csrules', version: JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version };

export function versions() {
  const pv = n => {
    try { return require(`${n}/package.json`).version; } catch { /* not exported */ }
    try { return JSON.parse(readFileSync(join(ROOT, 'node_modules', n, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
  };
  return { node: process.version, 'web-tree-sitter': pv('web-tree-sitter'), 'tree-sitter-c-sharp': pv('tree-sitter-c-sharp') };
}

let langPromise = null;
/** Initialise web-tree-sitter once and load the grammar (ABI checked by Language.load). */
export function loadLanguage() {
  if (!langPromise) {
    langPromise = (async () => {
      await Parser.init();
      const wasm = require.resolve('tree-sitter-c-sharp/tree-sitter-c_sharp.wasm');
      const lang = await Language.load(wasm);
      // Language.load() succeeds even when the ABI is unsupported; setLanguage() is where it fails
      // (e.g. web-tree-sitter <= 0.24.x: "Incompatible language version 15. Compatibility range 13 through 14").
      const probe = new Parser();
      try { probe.setLanguage(lang); }
      catch (e) { throw new Error(`grammar ABI ${lang.abiVersion} not supported by this web-tree-sitter (${e.message}); use web-tree-sitter >= 0.25`); }
      finally { probe.delete(); }
      return { lang, wasm };
    })();
  }
  return langPromise;
}

async function loadQueries(lang) {
  const dir = join(ROOT, 'queries');
  const out = {};
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.scm'))) {
    const src = await readFile(join(dir, f), 'utf8');
    try { out[f.replace(/\.scm$/, '')] = new Query(lang, src); }
    catch (e) { throw new Error(`query ${f} failed to compile: ${e.message}`); }
  }
  return out;
}

const SUPPRESS_RX = /csrules-disable(-next-line|-line|-file)?\b([^\n]*)/;

/** Parse suppression comments -> { file: Set|'*', lines: Map<line, Set|'*'> } */
function collectSuppressions(tree, query) {
  const lines = new Map(); let file = null;
  const ids = rest => {
    // Only the rule ids directly after the directive count: "R1, R3 -- reason text R9" -> R1, R3
    const head = /^[\s:]*((?:R\d+[\s,]*)*)/.exec(rest)[1];
    const list = head.match(/R\d+/g) || [];
    return list.length ? new Set(list) : '*';
  };
  const merge = (cur, add) => (cur === '*' || add === '*') ? '*' : new Set([...(cur || []), ...add]);
  for (const c of query.captures(tree.rootNode)) {
    const m = SUPPRESS_RX.exec(c.node.text);
    if (!m) continue;
    const kind = m[1] || '-line';
    const set = ids(m[2] || '');
    if (kind === '-file') { file = merge(file, set); continue; }
    const line = kind === '-next-line' ? c.node.endPosition.row + 2 : c.node.startPosition.row + 1;
    lines.set(line, merge(lines.get(line), set));
  }
  return { file, lines };
}
const covers = (s, id) => s === '*' || (s instanceof Set && s.has(id));

function contextLines(lines, line, radius = 2) {
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return { start, lines: lines.slice(start - 1, end) };
}

/** Group query matches into objects keyed by capture name. */
function matchesOf(query, node) {
  return query.matches(node).map(m => {
    const o = { pattern: m.patternIndex ?? m.pattern };
    for (const c of m.captures) if (!(c.name in o)) o[c.name] = c.node;
    return o;
  });
}

export async function createEngine({ config, debug = false, logger = null, onDebug = null, only = null }) {
  const { lang, wasm } = await loadLanguage();
  const queries = await loadQueries(lang);
  const parser = new Parser();
  parser.setLanguage(lang);
  const enabled = id => config.rules[id]?.enabled !== false && (!only || only.includes(id));
  logger?.info('engine ready', { wasm, abi: lang.abiVersion, versions: versions(), rules: ALL_RULE_IDS.filter(enabled) });
  const dbg = (obj) => { if (debug) { onDebug?.(obj); logger?.debug('debug', obj); } };

  async function checkFile(absPath, rel) {
    const findings = []; const suppressed = []; const allowed = [];
    const buf = await readFile(absPath);
    const isCs = /\.cs$/i.test(rel);
    let lines = null;
    // Context lines for reports; undecodable bytes (e.g. Big5) are shown as "?" instead of U+FFFD.
    const textLines = () => (lines ??= buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\uFFFD/g, '?').split(/\r?\n/));

    // R6 (byte level) — allowlist by path only
    if (enabled('R6') && isEncodingTarget(rel, config.rules.R6)) {
      const allowGlob = matchAny(rel, config.rules.R6.allow?.paths || []);
      for (const f of checkEncoding(buf, rel, config.rules.R6)) {
        const full = { ...f, severity: config.rules.R6.severity, file: rel };
        if (allowGlob) allowed.push({ ...full, reason: `path ${allowGlob}` }); else findings.push(full);
      }
    }
    if (!isCs) { for (const f of findings) f.context = contextLines(textLines(), f.line); return { findings, suppressed, allowed }; }

    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    const tree = parser.parse(text);
    try {
      if (tree.rootNode.hasError) logger?.warn('syntax errors in file (tree-sitter recovered)', { file: rel });
      const sup = collectSuppressions(tree, queries.comments);
      for (const rule of AST_RULES) {
        if (!enabled(rule.id)) continue;
        const cfg = config.rules[rule.id];
        const pathAllow = matchAny(rel, cfg.allow?.paths || []);
        const cache = new Map();
        const ctx = {
          cfg, file: rel,
          matches(name, node = tree.rootNode) {
            const key = name + ':' + node.id;
            if (!cache.has(key)) {
              const ms = matchesOf(queries[name], node);
              if (debug) for (const m of ms) dbg({ kind: 'match', rule: rule.id, query: name, file: rel, pattern: m.pattern, captures: Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'pattern').map(([k, n]) => [k, { type: n.type, at: `${n.startPosition.row + 1}:${n.startPosition.column + 1}`, text: n.text.length > 80 ? n.text.slice(0, 77) + '...' : n.text }])) });
              cache.set(key, ms);
            }
            return cache.get(key);
          },
          debugSkip(node, reason) { dbg({ kind: 'skip', rule: rule.id, file: rel, at: `${node.startPosition.row + 1}:${node.startPosition.column + 1}`, reason }); },
          report(node, key, params, suggestion) {
            const f = { ruleId: rule.id, severity: cfg.severity, file: rel, ...pos(node), message: message(key, params), suggestion, nodeType: node.type };
            const ec = enclosingContext(node);
            const attr = ec.attributes.find(a => (cfg.allow?.attributes || []).includes(a));
            const cls = ec.classes.find(c => matchName(c, cfg.allow?.classes || []));
            const reason = pathAllow ? `path ${pathAllow}` : attr ? `attribute [${attr}]` : cls ? `class ${cls}` : null;
            if (reason) { allowed.push({ ...f, reason }); dbg({ kind: 'allowed', rule: rule.id, file: rel, line: f.line, reason }); return; }
            const lineSup = sup.lines.get(f.line);
            if (covers(sup.file, rule.id) || covers(lineSup, rule.id)) { suppressed.push({ ...f, reason: 'inline comment' }); dbg({ kind: 'suppressed', rule: rule.id, file: rel, line: f.line }); return; }
            findings.push(f);
          },
        };
        rule.check(ctx);
      }
    } finally {
      tree.delete();
    }
    for (const f of findings) f.context = contextLines(textLines(), f.line);
    return { findings, suppressed, allowed };
  }

  return { checkFile, dispose: () => parser.delete() };
}

async function* walk(dir, root, exclude) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
  ents.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of ents) {
    const p = join(dir, e.name);
    const rel = toPosix(relative(root, p));
    if (e.isDirectory()) { if (!matchAny(rel + '/', exclude) && !matchAny(rel + '/x', exclude)) yield* walk(p, root, exclude); continue; }
    if (e.isFile()) yield { abs: p, rel };
  }
}

/** Collect target files: .cs per include/exclude, plus R6 encoding targets. */
export async function collectFiles(targets, config) {
  const files = [];
  for (const t of targets) {
    const abs = resolve(t);
    const st = await stat(abs);
    if (st.isFile()) { files.push({ abs, rel: toPosix(relative(process.cwd(), abs)) || abs, root: dirname(abs) }); continue; }
    for await (const f of walk(abs, abs, config.exclude || [])) {
      if (matchAny(f.rel, config.exclude || [])) continue;
      const wanted = matchAny(f.rel, config.include || ['**/*.cs']) || (config.rules.R6?.enabled !== false && isEncodingTarget(f.rel, config.rules.R6));
      if (wanted) files.push({ ...f, root: abs });
    }
  }
  return files;
}

const SEV_ORDER = { error: 3, warning: 2, note: 1 };

export async function run({ targets, config, debug = false, logger = null, onDebug = null, only = null, concurrency = 4 }) {
  const t0 = Date.now();
  const engine = await createEngine({ config, debug, logger, onDebug, only });
  const files = await collectFiles(targets, config);
  logger?.info('scan start', { targets, files: files.length });
  const results = new Array(files.length);
  let next = 0;
  // Parsing is synchronous inside wasm; a small pool overlaps file reads with parsing.
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (next < files.length) {
      const i = next++;
      try {
        results[i] = await engine.checkFile(files[i].abs, files[i].rel);
        // `file` is relative to the scan root (allowlists, SARIF SRCROOT); `path` is relative to cwd (clickable in terminals)
        const shown = toPosix(relative(process.cwd(), files[i].abs));
        for (const list of [results[i].findings, results[i].suppressed, results[i].allowed]) for (const f of list) f.path = shown;
      }
      catch (e) { logger?.error('file failed', { file: files[i].rel, error: e.stack }); results[i] = { findings: [], suppressed: [], allowed: [], error: e.message }; }
    }
  }));
  engine.dispose();
  const findings = results.flatMap(r => r.findings).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId));
  const suppressed = results.flatMap(r => r.suppressed).map(({ context, ...f }) => f);
  const allowed = results.flatMap(r => r.allowed).map(({ context, ...f }) => f);
  const errors = results.map((r, i) => r.error ? { file: files[i].rel, error: r.error } : null).filter(Boolean);
  const counts = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;
  const byRule = Object.fromEntries(ALL_RULE_IDS.map(id => [id, findings.filter(f => f.ruleId === id).length]));
  const summary = { total: findings.length, ...counts, byRule, files: files.length, suppressed: suppressed.length, allowed: allowed.length, ms: Date.now() - t0 };
  logger?.info('scan done', summary);
  return { tool: TOOL, versions: versions(), targets: targets.map(t => toPosix(relative(process.cwd(), resolve(t))) || '.'), summary, findings, suppressed, allowed, fileErrors: errors };
}

export function exitCodeFor(result, failOn = 'error') {
  if (failOn === 'none') return 0;
  const min = SEV_ORDER[failOn] ?? 3;
  return result.findings.some(f => SEV_ORDER[f.severity] >= min) ? 1 : 0;
}
