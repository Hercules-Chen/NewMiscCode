// Scenario validation. Prefers the real validateScenario from ../01-mcp-ui-verifier/src/scenario.js
// (the format owner); falls back to an equivalent local copy when 01 is not present or not installed.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERIFIER_ROOT } from './config.js';

const ACTIONS = ['open', 'click', 'fill', 'press', 'wait', 'wait_for', 'assert_visible', 'assert_hidden', 'assert_text', 'check_console_errors', 'screenshot_annotate'];

export function localValidate(sc, origin = 'scenario') {
  if (!sc || !Array.isArray(sc.steps)) throw new Error(`${origin}: "steps" array is required`);
  sc.steps.forEach((s, i) => {
    if (!s || typeof s.action !== 'string') throw new Error(`${origin}: step ${i + 1} has no "action"`);
    if (!ACTIONS.includes(s.action)) throw new Error(`${origin}: step ${i + 1} unknown action "${s.action}"`);
    const needsSel = ['click', 'fill', 'press', 'wait_for', 'assert_visible', 'assert_hidden', 'assert_text'];
    if (needsSel.includes(s.action) && !s.selector) throw new Error(`${origin}: step ${i + 1} (${s.action}) needs "selector"`);
    if (s.action === 'open' && !s.url) throw new Error(`${origin}: step ${i + 1} (open) needs "url"`);
  });
}

/** Load 01's validateScenario. Returns { validate, source: '01' | 'local' }. */
export async function loadValidator() {
  try {
    const mod = await import(pathToFileURL(path.join(VERIFIER_ROOT, 'src', 'scenario.js')).href);
    if (typeof mod.validateScenario === 'function') return { validate: mod.validateScenario, source: '01' };
  } catch { /* 01 missing or its node_modules not installed */ }
  return { validate: localValidate, source: 'local' };
}
