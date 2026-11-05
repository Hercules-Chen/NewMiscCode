// 每條 diff 規則的單元測試。 Unit tests: one case per diff rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpecs } from '../src/openapi/diff.js';
import { RULES } from '../src/openapi/rules.js';
import { loadSpec } from '../src/openapi/load.js';

const clone = o => structuredClone(o);
const json = (schema) => ({ content: { 'application/json': { schema } } });

/** 基準規格：GET/POST /items，帶參數、請求本文、回應本文。 */
function base() {
  return {
    openapi: '3.0.3',
    info: { title: 't', version: '1' },
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['a', 'b'] } }
          ],
          responses: {
            '200': {
              description: 'ok',
              headers: { 'X-Total': { schema: { type: 'integer' } } },
              ...json({ type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer', format: 'int32' }, name: { type: 'string' }, state: { type: 'string', enum: ['on', 'off'] }, tags: { type: 'array', items: { type: 'string' } } } })
            },
            '404': { description: 'nf' }
          }
        },
        post: {
          operationId: 'createItem',
          requestBody: { required: false, ...json({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 }, qty: { type: 'integer' }, mode: { type: 'string', enum: ['x', 'y'] } } }) },
          responses: { '201': { description: 'created' } }
        }
      },
      '/other': { get: { responses: { '200': { description: 'ok' } } } }
    }
  };
}

const G = s => s.paths['/items'].get;
const P = s => s.paths['/items'].post;
const RESP = s => G(s).responses['200'].content['application/json'].schema;
const REQ = s => P(s).requestBody.content['application/json'].schema;

// [rule, mutate(newSpec), mutateOld?(oldSpec)]
const CASES = [
  ['PATH_REMOVED', n => { delete n.paths['/other']; }],
  ['OPERATION_REMOVED', n => { delete n.paths['/items'].post; }],
  ['PATH_ADDED', n => { n.paths['/new'] = { get: { responses: { '200': { description: 'ok' } } } }; }],
  ['OPERATION_ADDED', n => { n.paths['/items'].put = { responses: { '200': { description: 'ok' } } }; }],
  ['OPERATION_DEPRECATED', n => { G(n).deprecated = true; }],
  ['OPERATION_ID_CHANGED', n => { G(n).operationId = 'getItems'; }],
  ['PARAM_REMOVED', n => { G(n).parameters.splice(1, 1); }],
  ['PARAM_ADDED_REQUIRED', n => { G(n).parameters.push({ name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } }); }],
  ['PARAM_ADDED_OPTIONAL', n => { G(n).parameters.push({ name: 'sort', in: 'query', schema: { type: 'string' } }); }],
  ['PARAM_BECAME_REQUIRED', n => { G(n).parameters[0].required = true; }],
  ['PARAM_BECAME_OPTIONAL', n => { G(n).parameters[0].required = false; }, o => { G(o).parameters[0].required = true; }],
  ['PARAM_LOCATION_CHANGED', n => { G(n).parameters[0] = { name: 'X-Limit', in: 'header', schema: { type: 'integer' } }; }],
  ['REQUEST_BODY_BECAME_REQUIRED', n => { P(n).requestBody.required = true; }],
  ['REQUEST_MEDIA_TYPE_REMOVED', n => { P(n).requestBody.content = { 'application/xml': { schema: {} } }; }],
  ['REQUEST_FIELD_ADDED_REQUIRED', n => { REQ(n).properties.currency = { type: 'string' }; REQ(n).required.push('currency'); }],
  ['REQUEST_FIELD_ADDED_OPTIONAL', n => { REQ(n).properties.coupon = { type: 'string' }; }],
  ['REQUEST_FIELD_BECAME_REQUIRED', n => { REQ(n).required.push('qty'); }],
  ['REQUEST_FIELD_REMOVED', n => { delete REQ(n).properties.qty; }],
  ['REQUEST_TYPE_CHANGED', n => { REQ(n).properties.qty = { type: 'string' }; }],
  ['REQUEST_ENUM_VALUE_REMOVED', n => { REQ(n).properties.mode.enum = ['x']; }],
  ['REQUEST_ENUM_VALUE_ADDED', n => { REQ(n).properties.mode.enum = ['x', 'y', 'z']; }],
  ['REQUEST_CONSTRAINT_TIGHTENED', n => { REQ(n).properties.name.maxLength = 50; }],
  ['RESPONSE_STATUS_REMOVED', n => { G(n).responses = { '201': G(n).responses['200'], '404': { description: 'nf' } }; }],
  ['RESPONSE_STATUS_REMOVED_ERROR', n => { delete G(n).responses['404']; }],
  ['RESPONSE_STATUS_ADDED', n => { G(n).responses['429'] = { description: 'slow down' }; }],
  ['RESPONSE_MEDIA_TYPE_REMOVED', n => { G(n).responses['200'].content = { 'text/plain': { schema: { type: 'string' } } }; }],
  ['RESPONSE_FIELD_REMOVED', n => { delete RESP(n).properties.state; }],
  ['RESPONSE_FIELD_ADDED', n => { RESP(n).properties.color = { type: 'string' }; }],
  ['RESPONSE_TYPE_CHANGED', n => { RESP(n).properties.id = { type: 'string' }; }],
  ['RESPONSE_REQUIRED_TO_OPTIONAL', n => { RESP(n).required = ['id']; }],
  ['RESPONSE_OPTIONAL_TO_REQUIRED', n => { RESP(n).required = ['id', 'name', 'state']; }],
  ['RESPONSE_BECAME_NULLABLE', n => { RESP(n).properties.name.nullable = true; }],
  ['RESPONSE_ENUM_VALUE_ADDED', n => { RESP(n).properties.state.enum = ['on', 'off', 'broken']; }],
  ['RESPONSE_ENUM_VALUE_REMOVED', n => { RESP(n).properties.state.enum = ['on']; }],
  ['RESPONSE_HEADER_REMOVED', n => { delete G(n).responses['200'].headers; }],
  ['FORMAT_CHANGED', n => { RESP(n).properties.id.format = 'int64'; }],
  ['SECURITY_ADDED', n => { G(n).security = [{ bearer: [] }]; }]
];

test('every rule in the rule table has a test case', () => {
  const covered = new Set(CASES.map(c => c[0]));
  for (const id of Object.keys(RULES)) assert.ok(covered.has(id), `missing test for ${id}`);
});

for (const [rule, mutate, mutateOld] of CASES) {
  test(`rule ${rule} (${RULES[rule].severity})`, () => {
    const o = base(), n = base();
    if (mutateOld) mutateOld(o);
    mutate(n);
    const findings = diffSpecs(o, n);
    const hit = findings.find(f => f.rule === rule);
    assert.ok(hit, `${rule} not detected; got ${findings.map(f => f.rule).join(',')}`);
    assert.equal(hit.severity, RULES[rule].severity);
    assert.ok(hit.message['zh-TW'] && hit.message.en, 'bilingual message');
    if (RULES[rule].severity !== 'BREAKING') {
      assert.equal(findings.filter(f => f.severity === 'BREAKING').length, 0, `${rule} should not produce BREAKING: ${findings.map(f => f.rule)}`);
    }
  });
}

test('identical specs produce no findings', () => {
  assert.deepEqual(diffSpecs(base(), base()), []);
});

test('path parameter rename is not a change (/a/{id} == /a/{itemId})', () => {
  const mk = name => ({ openapi: '3.0.3', paths: { [`/a/{${name}}`]: { get: { parameters: [{ name, in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } } } });
  assert.deepEqual(diffSpecs(mk('id'), mk('itemId')), []);
});

test('integer -> number widening in request is non-breaking; in response it is breaking', () => {
  const o = base(), n = base();
  REQ(n).properties.qty = { type: 'number' };
  RESP(n).properties.id = { type: 'number' };
  const f = diffSpecs(o, n);
  assert.ok(!f.some(x => x.rule === 'REQUEST_TYPE_CHANGED'));
  assert.ok(f.some(x => x.rule === 'RESPONSE_TYPE_CHANGED'));
});

test('OpenAPI 3.1 type arrays with null are treated as nullable', () => {
  const o = base(), n = base();
  RESP(n).properties.name = { type: ['string', 'null'] };
  assert.ok(diffSpecs(o, n).some(x => x.rule === 'RESPONSE_BECAME_NULLABLE'));
});

test('allOf is merged before comparing', () => {
  const o = base(), n = base();
  G(n).responses['200'].content['application/json'].schema = { allOf: [{ type: 'object', required: ['id'], properties: { id: { type: 'integer', format: 'int32' } } }, { type: 'object', required: ['name'], properties: { name: { type: 'string' }, state: { type: 'string', enum: ['on', 'off'] }, tags: { type: 'array', items: { type: 'string' } } } }] };
  assert.deepEqual(diffSpecs(o, n), []);
});

test('demo v1 -> v2: expected breaking changes', async () => {
  const a = await loadSpec(new URL('../demo/openapi-v1.yaml', import.meta.url).pathname);
  const b = await loadSpec(new URL('../demo/openapi-v2.yaml', import.meta.url).pathname);
  const f = diffSpecs(a.doc, b.doc);
  const rules = new Set(f.filter(x => x.severity === 'BREAKING').map(x => x.rule));
  for (const r of ['OPERATION_REMOVED', 'PARAM_LOCATION_CHANGED', 'REQUEST_ENUM_VALUE_REMOVED', 'RESPONSE_FIELD_REMOVED', 'RESPONSE_HEADER_REMOVED', 'RESPONSE_REQUIRED_TO_OPTIONAL', 'RESPONSE_TYPE_CHANGED', 'REQUEST_FIELD_ADDED_REQUIRED', 'RESPONSE_STATUS_REMOVED']) assert.ok(rules.has(r), r);
  const counts = { BREAKING: 0, NON_BREAKING: 0, INFO: 0 };
  for (const x of f) counts[x.severity]++;
  assert.deepEqual(counts, { BREAKING: 14, NON_BREAKING: 11, INFO: 1 });
  assert.ok(f.some(x => x.rule === 'PATH_ADDED' && x.location === '/orders/{orderId}/history'));
});
