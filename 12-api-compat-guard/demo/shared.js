// 示範伺服器共用工具。 Shared helpers for the demo servers.
import http from 'node:http';

export function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve(undefined);
      try { resolve(JSON.parse(s)); } catch { resolve(null); }
    });
  });
}

export function send(res, status, body, headers = {}) {
  if (body === undefined) { res.writeHead(status, headers); res.end(); return; }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export const authed = req => /^Bearer\s+\S+/.test(req.headers.authorization || '');

export async function listen(handler, port = 0) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(e => send(res, 500, { error: e.message }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

export function portArg(def) {
  const i = process.argv.indexOf('--port');
  return i > 0 ? Number(process.argv[i + 1]) : def;
}

// 共同種子資料（兩版相同的業務資料）。 Same seed data for both versions.
export const SEED = [
  { id: 'ord-1001', customerName: '王小明', email: 'ming@example.com', status: 'paid', items: [{ sku: 'TEA-001', qty: 2, price: 350 }, { sku: 'CUP-010', qty: 1, price: 550.5 }], note: '請於下午送達', createdAt: '2026-01-05T10:00:00Z' },
  { id: 'ord-1002', customerName: 'Alice Chen', email: 'alice@example.com', status: 'pending', items: [{ sku: 'TEA-002', qty: 1, price: 480 }], note: '', createdAt: '2026-01-06T08:30:00Z' }
];
export const totalOf = items => items.reduce((s, i) => s + i.qty * i.price, 0);
