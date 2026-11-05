#!/usr/bin/env node
// MCP server (stdio). Lets an AI agent drive a real Chromium via Playwright and collect evidence.
// Usage: node src/server.js [--lang zh-TW|en] [--out <dir>] [--headed] [--devtools] [--debug] [--trace] [--cdp-port 9222]
// NOTE: stdout is the MCP transport. Never console.log here; diagnostics go to the JSONL log and stderr.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseArgs, resolveOptions } from './config.js';
import { t } from './i18n.js';
import { VerifierSession } from './session.js';
import { Logger } from './logger.js';
import { runScenario, validateScenario } from './scenario.js';

const VERSION = '0.1.0';
const opts = resolveOptions(parseArgs(process.argv.slice(2)));
const L = opts.lang;

let session = null;
function getSession() {
  if (!session) session = new VerifierSession(opts, { name: 'mcp-session' });
  return session;
}

async function imageContent(file) {
  try {
    const buf = await fsp.readFile(file);
    return [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }];
  } catch {
    return [];
  }
}

/** Convert a recorded step into an MCP tool result (text + optional screenshot image). */
async function stepResult(s, rec, { withImage = rec.status === 'fail' } = {}) {
  const head = rec.status === 'pass' ? t(L, 'tool.result.pass') : t(L, 'tool.result.fail');
  const payload = { step: rec.no, action: rec.action, status: rec.status, message: rec.message, durationMs: rec.durationMs };
  if (rec.screenshot) payload.screenshot = path.join(s.runDir, rec.screenshot);
  if (rec.data) payload.data = rec.data;
  const content = [{ type: 'text', text: `${head}: ${rec.message}\n${JSON.stringify(payload, null, 2)}` }];
  if (withImage && rec.screenshot) content.push(...(await imageContent(path.join(s.runDir, rec.screenshot))));
  return { content };
}

function stepTool(action, mapArgs, { withImage } = {}) {
  return async (args) => {
    const s = getSession();
    const rec = await s.runStep({ action, ...mapArgs(args) });
    return stepResult(s, rec, withImage ? { withImage: true } : undefined);
  };
}

function errorResult(err) {
  return { isError: true, content: [{ type: 'text', text: t(L, 'cli.error', { message: err && err.message ? err.message : String(err) }) }] };
}

const server = new McpServer({ name: 'mcp-ui-verifier', version: VERSION });
// Server-level JSONL log (one file for the server lifetime; each browser session also has its own run log).
const serverLog = new Logger({ file: path.join(opts.outDir, 'mcp-server.jsonl'), level: opts.logLevel, stderr: opts.debug, base: { pid: process.pid } });

/** registerTool + structured logging of every call (args are logged with secrets masked). */
function reg(name, config, handler) {
  server.registerTool(name, config, async (args, extra) => {
    const t0 = performance.now();
    const safeArgs = { ...(args || {}) };
    if (safeArgs.secret && safeArgs.text !== undefined) safeArgs.text = '******';
    if (safeArgs.scenario) safeArgs.scenario = { name: safeArgs.scenario.name, steps: safeArgs.scenario.steps?.length };
    serverLog.info('tool.call', { tool: name, args: safeArgs });
    try {
      const res = await handler(args, extra);
      const first = res?.content?.find((c) => c.type === 'text')?.text?.split('\n')[0];
      serverLog.log(res?.isError ? 'warn' : 'info', 'tool.result', { tool: name, ms: Math.round(performance.now() - t0), isError: Boolean(res?.isError), summary: first });
      return res;
    } catch (err) {
      serverLog.error('tool.exception', { tool: name, error: String(err && err.stack || err) });
      return errorResult(err);
    }
  });
}

const timeoutArg = z.number().int().positive().optional().describe('Timeout in ms for this step (default from --timeout, 5000)');

reg('open_page', {
  title: 'Open page',
  description: 'Open a URL in the (lazily launched) Chromium page. Relative URLs resolve against --base-url. Returns HTTP status, title and load timings.',
  inputSchema: { url: z.string().describe('Absolute URL, or path relative to --base-url'), waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional() },
}, stepTool('open', (a) => a));

reg('click', {
  title: 'Click element',
  description: 'Click the first element matching a Playwright selector (CSS, text=..., role=..., etc.).',
  inputSchema: { selector: z.string(), timeout: timeoutArg },
}, stepTool('click', (a) => a));

reg('fill', {
  title: 'Fill input',
  description: 'Fill text into an input/textarea. Set secret=true to mask the value in report and logs.',
  inputSchema: { selector: z.string(), text: z.string(), secret: z.boolean().optional(), timeout: timeoutArg },
}, stepTool('fill', (a) => a));

reg('press', {
  title: 'Press key',
  description: 'Press a keyboard key (e.g. Enter, Tab, Control+A) on an element.',
  inputSchema: { selector: z.string(), key: z.string(), timeout: timeoutArg },
}, stepTool('press', (a) => a));

reg('assert_visible', {
  title: 'Assert visible',
  description: 'Assert that an element becomes visible within the timeout. On failure an annotated screenshot is attached.',
  inputSchema: { selector: z.string(), timeout: timeoutArg },
}, stepTool('assert_visible', (a) => a));

reg('assert_hidden', {
  title: 'Assert hidden',
  description: 'Assert that an element is hidden or absent within the timeout.',
  inputSchema: { selector: z.string(), timeout: timeoutArg },
}, stepTool('assert_hidden', (a) => a));

reg('assert_text', {
  title: 'Assert text',
  description: 'Assert the visible text of an element. mode: contains (default) | equals | regex. Whitespace is normalized. On failure the element is boxed in red in a screenshot.',
  inputSchema: { selector: z.string(), expected: z.string(), mode: z.enum(['contains', 'equals', 'regex']).optional(), timeout: timeoutArg },
}, stepTool('assert_text', (a) => a));

reg('check_console_errors', {
  title: 'Check console errors',
  description: 'Check console errors, uncaught exceptions, failed requests and HTTP >= 400 responses collected since the previous check (all=true for everything). Fails if any are found unless expectNone=false. ignore = regex list to skip.',
  inputSchema: { expectNone: z.boolean().optional(), all: z.boolean().optional(), ignore: z.array(z.string()).optional() },
}, stepTool('check_console_errors', (a) => a));

reg('screenshot_annotate', {
  title: 'Annotated screenshot',
  description: 'Take a (full-page by default) screenshot with RED BOXES and numbered labels drawn around every element matching the given selectors. Missing elements are listed in a red banner. Returns the PNG.',
  inputSchema: {
    selectors: z.array(z.string()).describe('Selectors of the elements to highlight (may be empty)'),
    label: z.string().optional().describe('Banner text describing the problem'),
    labels: z.array(z.string()).optional().describe('Per-selector labels (same order as selectors)'),
    fullPage: z.boolean().optional(),
  },
}, stepTool('screenshot_annotate', (a) => a, { withImage: true }));

reg('wait', {
  title: 'Wait',
  description: 'Wait for a number of milliseconds.',
  inputSchema: { ms: z.number().int().nonnegative().max(60000) },
}, stepTool('wait', (a) => a));

reg('get_page_info', {
  title: 'Get page info',
  description: 'Return the current URL, title and the first N characters of visible text, to help decide which selectors to verify.',
  inputSchema: { maxChars: z.number().int().positive().max(20000).optional() },
}, async ({ maxChars = 3000 }) => {
  try {
    const s = getSession();
    if (!s.page) return errorResult(new Error(t(L, 'msg.noPage')));
    const info = { url: s.page.url(), title: await s.page.title(), text: (await s.page.innerText('body').catch(() => '')).slice(0, maxChars) };
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  } catch (e) { return errorResult(e); }
});

reg('generate_report', {
  title: 'Generate HTML report',
  description: 'Write a self-contained HTML report (tabs: summary, steps, screenshots, console, environment) for all steps recorded in this session. Returns the file path.',
  inputSchema: {},
}, async () => {
  try {
    const s = getSession();
    const file = await s.generateReport();
    const sum = s.summary();
    return { content: [{ type: 'text', text: `${t(L, 'msg.reportWritten', { path: file })}\n${JSON.stringify({ report: file, runDir: s.runDir, log: s.logFile, summary: sum }, null, 2)}` }] };
  } catch (e) { return errorResult(e); }
});

reg('close_browser', {
  title: 'Close browser / end session',
  description: 'Write the report, save trace.zip (if --trace), close the browser. The next tool call starts a new session with a new run folder.',
  inputSchema: {},
}, async () => {
  try {
    if (!session) return { content: [{ type: 'text', text: 'no session' }] };
    const s = session;
    await s.stopTrace();
    const file = s.steps.length ? await s.generateReport() : null;
    await s.close();
    session = null;
    return { content: [{ type: 'text', text: JSON.stringify({ report: file, trace: s.tracePath, log: s.logFile, summary: s.summary() }, null, 2) }] };
  } catch (e) { return errorResult(e); }
});

reg('run_scenario', {
  title: 'Run scenario',
  description: 'Run a declarative scenario (JSON file path or inline object) in a fresh browser and write its HTML report. Actions: open, click, fill, press, wait, wait_for, assert_visible, assert_hidden, assert_text, check_console_errors, screenshot_annotate.',
  inputSchema: {
    file: z.string().optional().describe('Path to a scenario JSON file (absolute path recommended; relative paths resolve against the server process cwd)'),
    scenario: z.object({ name: z.string().optional(), baseUrl: z.string().optional(), stopOnFailure: z.boolean().optional(), steps: z.array(z.record(z.string(), z.any())) }).passthrough().optional().describe('Inline scenario object'),
    baseUrl: z.string().optional().describe('Override baseUrl'),
  },
}, async ({ file, scenario, baseUrl }) => {
  try {
    if (!file && !scenario) throw new Error('file or scenario is required');
    if (scenario) validateScenario(scenario);
    const o = { ...opts };
    if (baseUrl) o.baseUrl = baseUrl;
    const res = await runScenario(file ? path.resolve(file) : scenario, o);
    const s = res.summary;
    const lines = res.steps.map((r) => `[${r.status === 'pass' ? t(L, 'report.pass') : r.status === 'fail' ? t(L, 'report.fail') : t(L, 'report.skip')}] #${r.no} ${r.action} ${r.target} — ${r.message}`);
    const text = `${t(L, 'cli.summary', { passed: s.passed, failed: s.failed, skipped: s.skipped, total: s.total, ms: s.durationMs })}\n${lines.join('\n')}\n\n${JSON.stringify({ report: res.reportPath, runDir: res.runDir, log: res.logFile, trace: res.tracePath, summary: s }, null, 2)}`;
    return { content: [{ type: 'text', text }] };
  } catch (e) { return errorResult(e); }
});

let closing = false;
async function shutdown(reason) {
  if (closing) return;
  closing = true;
  try {
    serverLog.info('server.shutdown', { reason });
    if (session) {
      session.log.info('server.shutdown', { reason });
      await session.close();
    }
  } finally {
    await serverLog.flush();
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.stdin.on('close', () => shutdown('stdin closed'));

await server.connect(new StdioServerTransport());
serverLog.info('server.ready', { version: VERSION, opts: { ...opts } });
if (opts.debug) process.stderr.write(`[mcp-ui-verifier] v${VERSION} ready (lang=${L}, outDir=${opts.outDir})\n`);
