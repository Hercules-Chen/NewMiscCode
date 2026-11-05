// SARIF 2.1.0 reporter (GitHub code scanning / VS Code SARIF Viewer).
import { RULES_META } from '../i18n.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const HELP = {
  R1: 'Replace .Result / .Wait() / .GetAwaiter().GetResult() with await. Allowed in test projects and Startup via csrules.json allow lists.',
  R2: 'Use async Task instead of async void (event handlers excepted); call the *Async variant of I/O APIs.',
  R3: 'Return a tuple or result object instead of using out parameters (Try* pattern optionally ignored).',
  R4: 'Use IHttpClientFactory or a shared static HttpClient; use await Task.Delay instead of Thread.Sleep in async code.',
  R5: 'Log the exception (ILogger.LogError) or rethrow with throw;.',
  R6: '.bat/.cmd pure ASCII; .ps1 with non-ASCII needs a UTF-8 BOM; .cs/.md must be UTF-8.',
};

export function toSarif(result, { baseDir = process.cwd() } = {}) {
  const ids = Object.keys(RULES_META);
  const rules = ids.map(id => ({
    id,
    name: RULES_META[id].en.replace(/[^A-Za-z0-9]+/g, ''),
    shortDescription: { text: RULES_META[id].en },
    fullDescription: { text: `${RULES_META[id].en} / ${RULES_META[id]['zh-TW']}` },
    help: { text: HELP[id] },
    properties: { 'zh-TW': RULES_META[id]['zh-TW'] },
  }));
  const level = s => (s === 'error' ? 'error' : s === 'warning' ? 'warning' : 'note');
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: result.tool.name, version: result.tool.version, semanticVersion: result.tool.version, informationUri: 'https://github.com/tree-sitter/tree-sitter-c-sharp', rules } },
      originalUriBaseIds: { SRCROOT: { uri: pathToFileURL(resolve(baseDir)).href + '/' } },
      results: result.findings.map(f => ({
        ruleId: f.ruleId,
        ruleIndex: ids.indexOf(f.ruleId),
        level: level(f.severity),
        message: { text: f.message.en, markdown: `${f.message.en}\n\n${f.message['zh-TW']}` },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: encodeURI(f.file), uriBaseId: 'SRCROOT' },
            region: { startLine: f.line, startColumn: f.column, endLine: f.endLine, endColumn: f.endColumn },
          },
        }],
        ...(f.suggestion ? { properties: { suggestion: f.suggestion, messageZhTW: f.message['zh-TW'] } } : { properties: { messageZhTW: f.message['zh-TW'] } }),
      })),
      columnKind: 'utf16CodeUnits',
    }],
  };
}

/** Structural validation of the SARIF fields we rely on (used by tests). Returns a list of problems. */
export function validateSarif(s) {
  const p = [];
  if (s.version !== '2.1.0') p.push('version must be 2.1.0');
  if (!Array.isArray(s.runs) || !s.runs.length) p.push('runs[] required');
  for (const [ri, run] of (s.runs || []).entries()) {
    if (!run.tool?.driver?.name) p.push(`runs[${ri}].tool.driver.name required`);
    const ruleIds = new Set((run.tool?.driver?.rules || []).map(r => r.id));
    if (!Array.isArray(run.results)) p.push(`runs[${ri}].results[] required`);
    for (const [i, r] of (run.results || []).entries()) {
      if (!r.message?.text) p.push(`result ${i}: message.text required`);
      if (!r.ruleId || !ruleIds.has(r.ruleId)) p.push(`result ${i}: ruleId must reference a driver rule`);
      if (r.ruleIndex !== undefined && run.tool.driver.rules[r.ruleIndex]?.id !== r.ruleId) p.push(`result ${i}: ruleIndex mismatch`);
      if (!['none', 'note', 'warning', 'error'].includes(r.level)) p.push(`result ${i}: bad level`);
      const reg = r.locations?.[0]?.physicalLocation?.region;
      const uri = r.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
      if (!uri) p.push(`result ${i}: artifactLocation.uri required`);
      if (!reg || !(reg.startLine >= 1) || !(reg.startColumn >= 1)) p.push(`result ${i}: region.startLine/startColumn must be >= 1`);
    }
  }
  return p;
}
