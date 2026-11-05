// End-to-end MCP test: spawn src/server.js over stdio with the SDK client, list tools, call them against the demo site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startDemoServer } from '../demo/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let demo;
let client;
let outDir;

const text = (res) => res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

before(async () => {
  demo = await startDemoServer(0);
  outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'uiv-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'src', 'server.js'), '--lang', 'en', '--out', outDir, '--base-url', demo.url, '--timeout', '1500'],
    stderr: 'inherit',
    env: { ...process.env }, // the SDK passes only a minimal env by default; keep PLAYWRIGHT_BROWSERS_PATH etc.
  });
  client = new Client({ name: 'uiv-test-client', version: '0.0.1' });
  await client.connect(transport);
});

after(async () => {
  if (client) await client.close();
  if (demo) await demo.close();
});

test('lists the expected tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const n of ['open_page', 'click', 'fill', 'assert_visible', 'assert_text', 'check_console_errors', 'screenshot_annotate', 'run_scenario', 'generate_report', 'close_browser', 'get_page_info']) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
});

test('interactive session: open, fill, click, assert, console, annotate, report', async () => {
  let r = await client.callTool({ name: 'open_page', arguments: { url: '/' } });
  assert.match(text(r), /^PASS/);
  assert.match(text(r), /Demo Shop/);

  r = await client.callTool({ name: 'fill', arguments: { selector: '#username', text: 'Alice' } });
  assert.match(text(r), /^PASS/);
  r = await client.callTool({ name: 'click', arguments: { selector: '#login-btn' } });
  assert.match(text(r), /^PASS/);
  r = await client.callTool({ name: 'assert_text', arguments: { selector: '#login-msg', expected: 'Welcome, Alice' } });
  assert.match(text(r), /^PASS/);

  // Deliberate bug 1: wrong price -> FAIL with an annotated screenshot image attached
  r = await client.callTool({ name: 'assert_text', arguments: { selector: '#price', expected: 'NT$ 1,280', timeout: 800 } });
  assert.match(text(r), /^FAIL/);
  assert.ok(r.content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 1000), 'failure screenshot attached');

  r = await client.callTool({ name: 'check_console_errors', arguments: {} });
  assert.match(text(r), /^PASS/);
  // Deliberate bug 2: button throws
  await client.callTool({ name: 'click', arguments: { selector: '#add-to-cart' } });
  r = await client.callTool({ name: 'check_console_errors', arguments: {} });
  assert.match(text(r), /^FAIL/);
  assert.match(text(r), /TypeError/);

  // Deliberate bug 3: missing element
  r = await client.callTool({ name: 'assert_visible', arguments: { selector: '#contact-link', timeout: 500 } });
  assert.match(text(r), /^FAIL/);

  r = await client.callTool({ name: 'screenshot_annotate', arguments: { selectors: ['#price', '#missing-thing'], label: 'test annotation' } });
  assert.match(text(r), /1 not found/);
  const img = r.content.find((c) => c.type === 'image');
  assert.ok(img, 'annotated image returned');
  const shotPath = JSON.parse(text(r).slice(text(r).indexOf('{'))).screenshot;
  assert.ok(fs.existsSync(shotPath), 'screenshot file exists');

  r = await client.callTool({ name: 'get_page_info', arguments: {} });
  assert.match(text(r), /Notebook NB-01/);

  r = await client.callTool({ name: 'generate_report', arguments: {} });
  const info = JSON.parse(text(r).slice(text(r).indexOf('{')));
  assert.ok(fs.existsSync(info.report), 'report exists');
  assert.equal(info.summary.failed, 3);
  const html = await fsp.readFile(info.report, 'utf8');
  assert.match(html, /UI Verification Report/);
  assert.match(html, /data:image\/png;base64,/);

  r = await client.callTool({ name: 'close_browser', arguments: {} });
  assert.ok(fs.existsSync(JSON.parse(text(r)).log), 'log file exists');
});

test('run_scenario tool runs the demo scenario file', async () => {
  const r = await client.callTool({ name: 'run_scenario', arguments: { file: path.join(ROOT, 'scenarios', 'demo.json'), baseUrl: demo.url } });
  const t = text(r);
  assert.match(t, /4 failed/);
  const info = JSON.parse(t.slice(t.indexOf('\n\n{') + 2));
  assert.ok(fs.existsSync(info.report));
  assert.equal(info.summary.total, 14);
});

test('run_scenario with an inline passing scenario', async () => {
  const r = await client.callTool({
    name: 'run_scenario',
    arguments: { scenario: { name: 'inline-pass', baseUrl: demo.url, steps: [{ action: 'open', url: '/' }, { action: 'assert_visible', selector: '#login-form' }, { action: 'check_console_errors' }] } },
  });
  assert.match(text(r), /3 passed \/ 0 failed/);
});
