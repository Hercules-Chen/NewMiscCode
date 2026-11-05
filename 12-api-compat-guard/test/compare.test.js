// 重播比對與忽略規則測試。 Replay comparison + ignore rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareExchange, compareJson, effectiveOptions } from '../src/traffic/compare.js';
import { compile, matches } from '../src/traffic/jsonpath.js';

const opts = (o = {}, method = 'GET', url = '/x') => effectiveOptions(o, method, url);
const rules = d => d.map(x => x.rule).sort();
const resp = (status, value, ct = 'application/json') => ({ status, headers: { 'content-type': ct }, body: { kind: 'json', value } });

test('jsonpath subset', () => {
  assert.ok(matches(compile('$.a.b'), ['a', 'b']));
  assert.ok(matches(compile('$.items[*].id'), ['items', 3, 'id']));
  assert.ok(matches(compile('$..id'), ['items', 0, 'meta', 'id']));
  assert.ok(matches(compile('$.items[0]'), ['items', 0]));
  assert.ok(!matches(compile('$.items[0]'), ['items', 1]));
  assert.ok(!matches(compile('$.a'), ['a', 'b']));
  assert.throws(() => compile('a.b'));
});

test('identical responses -> no diffs', () => {
  assert.deepEqual(compareExchange(resp(200, { a: 1, b: [1, 2] }), resp(200, { a: 1, b: [1, 2] }), opts()), []);
});

test('status, missing field, added field, type change, value change', () => {
  const d = compareExchange(resp(200, { a: 1, b: 'x', c: true }), resp(201, { a: '1', b: 'y', d: 1 }), opts({ statusClassMismatchSkipsBody: false }));
  assert.deepEqual(rules(d), ['FIELD_ADDED', 'FIELD_MISSING', 'STATUS_CHANGED', 'TYPE_CHANGED', 'VALUE_CHANGED']);
  assert.equal(d.find(x => x.rule === 'FIELD_MISSING').field, '$.c');
  assert.equal(d.find(x => x.rule === 'FIELD_ADDED').severity, 'NON_BREAKING');
});

test('2xx -> 4xx reports only the status (no body noise)', () => {
  const d = compareExchange(resp(201, { id: 1, name: 'a' }), resp(400, { error: 'x' }), opts());
  assert.deepEqual(rules(d), ['STATUS_CHANGED']);
});

test('timestamps and UUIDs ignored by default; can be turned off', () => {
  const a = { at: '2026-01-05T10:00:00Z', id: '3f2b8c1e-8d1a-4c7e-9a43-2b5f0d7c9e11' };
  const b = { at: '2026-03-01T00:00:00.000Z', id: '0b1c8c1e-8d1a-4c7e-9a43-2b5f0d7c9e99' };
  assert.deepEqual(compareJson(a, b, opts()), []);
  assert.deepEqual(rules(compareJson(a, b, opts({ ignoreTimestamps: false, ignoreUuids: false }))), ['VALUE_CHANGED', 'VALUE_CHANGED']);
});

test('ignorePaths ignores values but still checks type/presence; skipPaths skips entirely', () => {
  const o = opts({ ignorePaths: ['$..id'], skipPaths: ['$.debug'] });
  assert.deepEqual(compareJson({ id: 'ord-1', items: [{ id: 7 }], debug: { x: 1 } }, { id: 'ord-99', items: [{ id: 8 }] }, o), []);
  assert.deepEqual(rules(compareJson({ id: 'ord-1' }, { id: 5 }, o)), ['TYPE_CHANGED']);
  assert.deepEqual(rules(compareJson({ id: 'ord-1' }, {}, o)), ['FIELD_MISSING']);
});

test('array order: strict vs ignore', () => {
  const a = { xs: [{ k: 1 }, { k: 2 }] }, b = { xs: [{ k: 2 }, { k: 1 }] };
  assert.equal(compareJson(a, b, opts()).length, 2);
  assert.deepEqual(compareJson(a, b, opts({ arrayOrder: 'ignore' })), []);
  assert.deepEqual(rules(compareJson({ xs: [1] }, { xs: [1, 2] }, opts())), ['ARRAY_LENGTH_CHANGED']);
});

test('compareValues=false checks only shape', () => {
  assert.deepEqual(compareJson({ a: 1, s: 'x', xs: [1] }, { a: 2, s: 'y', xs: [3, 4] }, opts({ compareValues: false })), []);
});

test('null handling: value -> null is breaking, null -> value is info', () => {
  assert.equal(compareJson({ a: 1 }, { a: null }, opts())[0].severity, 'BREAKING');
  assert.equal(compareJson({ a: null }, { a: 1 }, opts())[0].rule, 'NULL_TO_VALUE');
});

test('per-endpoint rules match by method and glob', () => {
  const cfg = { rules: [{ match: 'POST /orders', ignorePaths: ['$.id'] }, { match: 'GET /orders/*', compareValues: false }] };
  assert.deepEqual(compareJson({ id: 'a' }, { id: 'b' }, effectiveOptions(cfg, 'POST', '/orders')), []);
  assert.equal(compareJson({ id: 'a' }, { id: 'b' }, effectiveOptions(cfg, 'GET', '/orders')).length, 1);
  assert.deepEqual(compareJson({ n: 1 }, { n: 2 }, effectiveOptions(cfg, 'GET', '/orders/ord-1?x=1')), []);
});

test('headers subset: content-type media type compared, charset ignored', () => {
  assert.deepEqual(compareExchange(resp(200, {}, 'application/json; charset=utf-8'), resp(200, {}, 'application/json'), opts()), []);
  const d = compareExchange({ status: 200, headers: { 'content-type': 'application/json', 'x-total-count': '3' }, body: { kind: 'json', value: {} } },
    { status: 200, headers: { 'content-type': 'text/plain' }, body: { kind: 'json', value: {} } }, opts({ headers: ['content-type', 'X-Total-Count'] }));
  assert.deepEqual(rules(d), ['HEADER_CHANGED', 'HEADER_MISSING']);
});
