// 由 OpenAPI examples 產生 Mock 伺服器。 Mock server from OpenAPI examples.
import http from 'node:http';
import { nullLogger } from '../env.js';

export function sampleFromSchema(s, depth = 0) {
  if (!s || depth > 8 || s['x-circular-ref']) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (Array.isArray(s.allOf)) return Object.assign({}, ...s.allOf.map(x => sampleFromSchema(x, depth + 1) || {}));
  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) return sampleFromSchema((s.oneOf || s.anyOf)[0], depth + 1);
  const type = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type || (s.properties ? 'object' : s.items ? 'array' : 'string');
  switch (type) {
    case 'object': return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, sampleFromSchema(v, depth + 1)]));
    case 'array': return [sampleFromSchema(s.items || {}, depth + 1)];
    case 'integer': return 0;
    case 'number': return 0;
    case 'boolean': return true;
    default: return s.format === 'date-time' ? '2026-01-01T00:00:00Z' : 'string';
  }
}

function pickResponse(op) {
  const entries = Object.entries(op.responses || {});
  const [status, resp] = entries.find(([s]) => /^2/.test(s)) || entries[0] || ['200', {}];
  const media = Object.entries(resp.content || {}).find(([m]) => /json/i.test(m));
  if (!media) return { status: Number(status) || 200, body: null };
  const mt = media[1] || {};
  let body;
  if (mt.example !== undefined) body = mt.example;
  else if (mt.examples && Object.values(mt.examples)[0]) body = Object.values(mt.examples)[0].value;
  else body = sampleFromSchema(mt.schema || {});
  return { status: Number(status) || 200, body };
}

export async function startMock(doc, { port = 0, host = '127.0.0.1', logger = nullLogger } = {}) {
  const routes = [];
  for (const [p, item] of Object.entries(doc.paths || {})) {
    const rx = new RegExp('^' + p.replace(/[.+^$()|\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '/?$');
    for (const m of ['get', 'put', 'post', 'delete', 'patch', 'head', 'options']) if (item[m]) routes.push({ rx, method: m.toUpperCase(), op: item[m], path: p });
  }
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const route = routes.find(r => r.method === req.method && r.rx.test(path));
    req.resume();
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no mock route', method: req.method, path }));
      return;
    }
    const { status, body } = pickResponse(route.op);
    logger.info('mock.hit', { method: req.method, path, route: route.path, status });
    if (body === null || status === 204) { res.writeHead(status); res.end(); return; }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-apiguard-mock': '1' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, port: server.address().port, routes: routes.length, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
