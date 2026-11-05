// $ref 解析測試。 $ref resolution tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { dereference, loadSpec, parseText } from '../src/openapi/load.js';

test('internal $ref is resolved (nested, parameters, responses)', async () => {
  const doc = {
    openapi: '3.0.3',
    paths: { '/a': { get: { parameters: [{ $ref: '#/components/parameters/P' }], responses: { '200': { $ref: '#/components/responses/R' } } } } },
    components: {
      parameters: { P: { name: 'p', in: 'query', schema: { $ref: '#/components/schemas/S' } } },
      responses: { R: { description: 'r', content: { 'application/json': { schema: { $ref: '#/components/schemas/Obj' } } } } },
      schemas: { S: { type: 'string' }, Obj: { type: 'object', properties: { s: { $ref: '#/components/schemas/S' } } } }
    }
  };
  const { doc: d, refs } = await dereference(doc);
  const op = d.paths['/a'].get;
  assert.equal(op.parameters[0].name, 'p');
  assert.equal(op.parameters[0].schema.type, 'string');
  assert.equal(op.responses['200'].content['application/json'].schema.properties.s.type, 'string');
  assert.ok(refs.includes('#/components/schemas/S'));
});

test('circular $ref does not loop forever', async () => {
  const doc = { components: { schemas: { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } } } }, paths: { '/n': { get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } } } } };
  const { doc: d } = await dereference(doc);
  const s = d.paths['/n'].get.responses['200'].content['application/json'].schema;
  assert.equal(s.properties.child['x-circular-ref'], '#/components/schemas/Node');
});

test('JSON pointer escapes (~1) and missing ref error', async () => {
  const doc = { a: { 'x/y': { v: 1 } }, b: { $ref: '#/a/x~1y' } };
  assert.equal((await dereference(doc)).doc.b.v, 1);
  await assert.rejects(dereference({ b: { $ref: '#/nope' } }), /\$ref not found/);
});

test('external relative file $ref (demo common.yaml) resolves', async () => {
  const s = await loadSpec(new URL('../demo/openapi-v1.yaml', import.meta.url).pathname);
  const err = s.doc.paths['/orders/{id}'].get.responses['404'].content['application/json'].schema;
  assert.equal(err.type, 'object');
  assert.deepEqual(err.required, ['error']);
  assert.ok(s.refs.includes('common.yaml#/Error'));
});

test('JSON spec files and Swagger 2.0 rejection', async () => {
  const dir = await mkdtemp(join(os.tmpdir(), 'apiguard-ref-'));
  try {
    await writeFile(join(dir, 'a.json'), JSON.stringify({ openapi: '3.1.0', paths: { '/x': { get: { responses: { '200': { $ref: '#/components/responses/Ok' } } } } }, components: { responses: { Ok: { description: 'ok' } } } }));
    const s = await loadSpec(join(dir, 'a.json'));
    assert.equal(s.doc.paths['/x'].get.responses['200'].description, 'ok');
    await writeFile(join(dir, 'b.yaml'), 'swagger: "2.0"\npaths: {}\n');
    await assert.rejects(loadSpec(join(dir, 'b.yaml')), /Swagger 2\.0/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('YAML with BOM and Chinese text parses', () => {
  const d = parseText('﻿openapi: 3.0.0\ninfo:\n  title: 訂單\n', 'x.yaml');
  assert.equal(d.info.title, '訂單');
});
