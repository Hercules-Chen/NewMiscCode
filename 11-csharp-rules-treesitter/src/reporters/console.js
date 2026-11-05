// Console reporter: file:line:col: severity RULE message
import { ui } from '../i18n.js';

const C = { error: '\x1b[31m', warning: '\x1b[33m', note: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };

export function formatConsole(result, { lang = 'zh-TW', color = false, fixSuggestions = false } = {}) {
  const c = k => (color ? C[k] : '');
  const out = [];
  for (const f of result.findings) {
    out.push(`${f.path || f.file}:${f.line}:${f.column}: ${c(f.severity)}${f.severity}${c('reset')} ${c('bold')}${f.ruleId}${c('reset')} ${f.message[lang] || f.message.en}`);
    if (fixSuggestions && f.suggestion) {
      out.push(`    ${c('dim')}${ui(lang, 'suggestion')}:${c('reset')}`);
      for (const l of f.suggestion.split('\n')) out.push(`      ${l}`);
    }
  }
  const s = result.summary;
  if (!result.findings.length) out.push(ui(lang, 'noFindings'));
  out.push(ui(lang, 'summary', s));
  if (s.suppressed) out.push(ui(lang, 'suppressed', { n: s.suppressed }));
  if (s.allowed) out.push(ui(lang, 'allowed', { n: s.allowed }));
  return out.join('\n');
}
