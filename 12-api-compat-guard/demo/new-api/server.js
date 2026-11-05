// 新版訂單 API（v2，改寫版，刻意含破壞性與非破壞性變更）。
// New order API (v2) - rewritten with deliberate breaking and non-breaking changes.
// Usage: node demo/new-api/server.js --port 3002
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readJson, send, authed, listen, portArg, SEED, totalOf } from '../shared.js';

const STATUSES = ['pending', 'paid', 'shipped']; // 破壞性：移除 cancelled

export async function startNewApi(port = 0) {
  const orders = new Map(SEED.map(o => [o.id, { ...structuredClone(o), currency: 'TWD', updatedAt: o.createdAt }]));
  // 破壞性：customerName/email 移到 customer 物件、total 改成字串、note 空字串時省略
  const view = o => ({
    id: o.id,
    customer: { name: o.customerName, email: o.email },
    status: o.status,
    total: totalOf(o.items).toFixed(2),
    currency: o.currency,
    items: o.items,
    ...(o.note ? { note: o.note } : {}),
    createdAt: new Date(o.createdAt).toISOString(), // 不同格式但同一時間（會被時間戳規則忽略）
    updatedAt: new Date(o.updatedAt).toISOString()
  });
  return listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (req.method === 'GET' && p === '/health') return send(res, 200, { status: 'ok', version: 'v1' });
    if (req.method === 'POST' && p === '/login') {
      const b = await readJson(req);
      if (!b || !b.username || !b.password) return send(res, 400, { error: 'username and password required' });
      return send(res, 200, { token: `v2-${randomUUID()}`, user: b.username });
    }
    if (!p.startsWith('/orders')) return send(res, 404, { error: 'not found' });
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && p === '/orders') {
      const status = u.searchParams.get('status');
      if (status && !STATUSES.includes(status)) return send(res, 400, { error: 'bad status' });
      const limit = Number(req.headers['x-limit'] || 50); // 破壞性：limit 改由標頭傳入
      let all = [...orders.values()].filter(o => !status || o.status === status);
      if (u.searchParams.get('sort') === 'total') all = all.sort((a, b) => totalOf(a.items) - totalOf(b.items));
      const items = all.slice(0, limit).map(view);
      return send(res, 200, { items, count: items.length }); // 破壞性：拿掉 X-Total-Count
    }
    if (req.method === 'POST' && p === '/orders') {
      const b = await readJson(req);
      if (!b || typeof b.customerName !== 'string' || !Array.isArray(b.items)) return send(res, 400, { error: 'customerName and items required' });
      if (!b.currency) return send(res, 400, { error: 'currency required' }); // 破壞性：新增必填欄位
      const now = new Date().toISOString();
      const o = { id: randomUUID(), customerName: b.customerName, email: b.email || '', status: 'pending', currency: b.currency, items: b.items.map(i => ({ sku: i.sku, qty: i.qty, price: 100 })), note: b.note || '', createdAt: now, updatedAt: now };
      orders.set(o.id, o);
      return send(res, 200, view(o)); // 破壞性：201 -> 200
    }
    const h = /^\/orders\/([^/]+)\/history$/.exec(p);
    if (h && req.method === 'GET') { // 非破壞性：新增端點
      const o = orders.get(decodeURIComponent(h[1]));
      return o ? send(res, 200, [{ at: o.createdAt, status: 'pending' }, { at: o.updatedAt, status: o.status }]) : send(res, 404, { error: 'order not found' });
    }
    const m = /^\/orders\/([^/]+)$/.exec(p);
    if (m && req.method === 'GET') {
      const o = orders.get(decodeURIComponent(m[1]));
      return o ? send(res, 200, view(o)) : send(res, 404, { error: 'order not found' });
    }
    // 破壞性：DELETE /orders/{id} 已移除
    return send(res, 404, { error: 'not found' });
  }, port);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const s = await startNewApi(portArg(3002));
  console.log(`new-api (v2) listening on ${s.url}`);
}
