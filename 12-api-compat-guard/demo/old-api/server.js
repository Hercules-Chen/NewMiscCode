// 舊版訂單 API（v1）。 Old order API (v1). Usage: node demo/old-api/server.js --port 3001
import { pathToFileURL } from 'node:url';
import { readJson, send, authed, listen, portArg, SEED, totalOf } from '../shared.js';

const STATUSES = ['pending', 'paid', 'shipped', 'cancelled'];

export async function startOldApi(port = 0) {
  const orders = new Map(SEED.map(o => [o.id, structuredClone(o)]));
  let seq = 2000;
  const view = o => ({ id: o.id, customerName: o.customerName, email: o.email, status: o.status, total: totalOf(o.items), items: o.items, note: o.note, createdAt: o.createdAt });
  return listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (req.method === 'GET' && p === '/health') return send(res, 200, { status: 'ok', version: 'v1' });
    if (req.method === 'POST' && p === '/login') {
      const b = await readJson(req);
      if (!b || !b.username || !b.password) return send(res, 400, { error: 'username and password required' });
      return send(res, 200, { token: `v1-${Date.now()}`, user: b.username });
    }
    if (!p.startsWith('/orders')) return send(res, 404, { error: 'not found' });
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && p === '/orders') {
      const status = u.searchParams.get('status');
      if (status && !STATUSES.includes(status)) return send(res, 400, { error: 'bad status' });
      const limit = Number(u.searchParams.get('limit') || 50);
      const all = [...orders.values()].filter(o => !status || o.status === status);
      const items = all.slice(0, limit).map(view);
      return send(res, 200, { items, count: items.length }, { 'x-total-count': String(all.length) });
    }
    if (req.method === 'POST' && p === '/orders') {
      const b = await readJson(req);
      if (!b || typeof b.customerName !== 'string' || !Array.isArray(b.items)) return send(res, 400, { error: 'customerName and items required' });
      const o = { id: `ord-${++seq}`, customerName: b.customerName, email: b.email || '', status: 'pending', items: b.items.map(i => ({ sku: i.sku, qty: i.qty, price: 100 })), note: b.note || '', createdAt: new Date().toISOString() };
      orders.set(o.id, o);
      return send(res, 201, view(o));
    }
    const m = /^\/orders\/([^/]+)$/.exec(p);
    if (m) {
      const o = orders.get(decodeURIComponent(m[1]));
      if (!o) return send(res, 404, { error: 'order not found' });
      if (req.method === 'GET') return send(res, 200, view(o));
      if (req.method === 'DELETE') { orders.delete(o.id); return send(res, 204); }
    }
    return send(res, 404, { error: 'not found' });
  }, port);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const s = await startOldApi(portArg(3001));
  console.log(`old-api (v1) listening on ${s.url}`);
}
