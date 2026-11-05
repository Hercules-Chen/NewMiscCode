// Declarative scenario runner: JSON file -> steps -> report.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { VerifierSession } from './session.js';

export const ACTIONS = ['open', 'click', 'fill', 'press', 'wait', 'wait_for', 'assert_visible', 'assert_hidden', 'assert_text', 'check_console_errors', 'screenshot_annotate'];

export async function loadScenario(file) {
  let raw = await fsp.readFile(file, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // tolerate BOM written by Windows editors
  const sc = JSON.parse(raw);
  validateScenario(sc, file);
  if (!sc.name) sc.name = path.basename(file, path.extname(file));
  return sc;
}

export function validateScenario(sc, origin = 'scenario') {
  if (!sc || !Array.isArray(sc.steps)) throw new Error(`${origin}: "steps" array is required`);
  sc.steps.forEach((s, i) => {
    if (!s || typeof s.action !== 'string') throw new Error(`${origin}: step ${i + 1} has no "action"`);
    if (!ACTIONS.includes(s.action)) throw new Error(`${origin}: step ${i + 1} unknown action "${s.action}" (allowed: ${ACTIONS.join(', ')})`);
    const needsSel = ['click', 'fill', 'press', 'wait_for', 'assert_visible', 'assert_hidden', 'assert_text'];
    if (needsSel.includes(s.action) && !s.selector) throw new Error(`${origin}: step ${i + 1} (${s.action}) needs "selector"`);
    if (s.action === 'open' && !s.url) throw new Error(`${origin}: step ${i + 1} (open) needs "url"`);
  });
}

/**
 * Run a scenario (object or JSON path). Always closes the browser.
 * @returns {Promise<{summary, reportPath, runDir, logFile, tracePath, steps, session}>}
 */
export async function runScenario(scenarioOrFile, opts, { onStep } = {}) {
  const sc = typeof scenarioOrFile === 'string' ? await loadScenario(scenarioOrFile) : (validateScenario(scenarioOrFile), scenarioOrFile);
  const o = { ...opts };
  if (!o.baseUrl && sc.baseUrl) o.baseUrl = sc.baseUrl;
  if (sc.viewport) o.viewport = sc.viewport;
  if (sc.timeout && !opts.timeoutExplicit) o.timeout = sc.timeout;
  const session = new VerifierSession(o, { name: sc.name || 'scenario' });
  session.log.info('scenario.start', { name: sc.name, steps: sc.steps.length, baseUrl: o.baseUrl });
  let reportPath;
  try {
    await session.start();
    await session.runSteps(sc.steps, { stopOnFailure: Boolean(sc.stopOnFailure), onStep });
  } finally {
    await session.stopTrace();
    reportPath = await session.generateReport();
    await session.close();
  }
  const summary = session.summary();
  session.log.info('scenario.end', summary);
  await session.log.flush();
  return { summary, reportPath, runDir: session.runDir, logFile: session.logFile, tracePath: session.tracePath, steps: session.steps, session };
}
