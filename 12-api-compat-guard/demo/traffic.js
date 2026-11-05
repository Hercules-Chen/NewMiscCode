// 模擬「舊客戶端」送出的請求（經過錄製代理）。 Simulated old-client traffic (through the recording proxy).
import { pathToFileURL } from 'node:url';

export const DEMO_SECRET_TOKEN = 'Bearer demo-secret-token-123';
export const DEMO_PASSWORD = 'S3cret!pass';

export async function sendDemoTraffic(base) {
  const auth = { authorization: DEMO_SECRET_TOKEN, cookie: 'session=abc123secret' };
  const calls = [
    ['GET', '/health'],
    ['POST', '/login', { username: 'demo', password: DEMO_PASSWORD }],
    ['GET', '/orders?limit=1', null, auth],
    ['GET', '/orders/ord-1001', null, auth],
    ['GET', '/orders/ord-1002', null, auth],
    ['POST', '/orders', { customerName: '林大華', items: [{ sku: 'TEA-003', qty: 3 }] }, auth],
    ['GET', '/orders?status=cancelled', null, auth],
    ['DELETE', '/orders/ord-1002', null, auth]
  ];
  const results = [];
  for (const [method, path, body, headers = {}] of calls) {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    await res.arrayBuffer();
    results.push({ method, path, status: res.status });
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const base = process.argv[2] || 'http://127.0.0.1:9000';
  for (const r of await sendDemoTraffic(base)) console.log(`${r.method} ${r.path} -> ${r.status}`);
}
