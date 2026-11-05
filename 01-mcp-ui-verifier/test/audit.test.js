// Runs the text-file audit (UTF-8, BOM rules, no U+FFFD, ASCII .bat) as part of npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('text-file audit passes', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(ROOT, 'scripts', 'audit-text.js'), ROOT]);
  assert.match(stdout, /Text audit OK/);
});
