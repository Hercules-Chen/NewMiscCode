'use strict';
// "orders" service: SQLite (node:sqlite) persistence + outbound fetch() to pricing.
// Endpoints: POST /orders, GET /orders/:id, GET /orders/report?ms= (slow path), GET /orders/fail (error path).
const path = require('node:path');
const fs = require('node:fs');
const { runService } = require('./base.cjs');
const { withSpan, sleep, SpanKind, SpanStatusCode } = require('./spans.cjs');

runService('orders', ({ route, tracer, log, cfg, args }) => {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const dbFile = path.join(cfg.dataDir, 'orders-demo.db');
  const db = new DatabaseSync(dbFile);
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, qty INTEGER NOT NULL,
    unit_price INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  const pricingUrl = String(args.pricing || process.env.OTV_PRICING_URL || 'http://127.0.0.1:3403').replace(/\/$/, '');

  // A DB call wrapped in a CLIENT span that follows the OpenTelemetry database semantic conventions.
  function dbSpan(operation, sql, fn) {
    return withSpan(tracer, `${operation} orders`, {
      kind: SpanKind.CLIENT,
      attributes: { 'db.system.name': 'sqlite', 'db.operation.name': operation, 'db.collection.name': 'orders', 'db.query.text': sql, 'db.namespace': path.basename(dbFile) },
    }, async (span) => {
      const result = fn();
      if (result && typeof result.changes !== 'undefined') span.setAttribute('db.response.affected_rows', Number(result.changes));
      return result;
    });
  }

  route('POST', '/orders', async ({ body, json }) => {
    const item = String(body.item || '');
    const qty = Number(body.qty || 1);
    return withSpan(tracer, 'orders.create', { attributes: { 'app.item': item, 'app.qty': qty } }, async (span) => {
      if (!item || !Number.isInteger(qty) || qty < 1 || qty > 100) {
        span.addEvent('validation.failed', { 'app.reason': 'item required, qty 1..100' });
        log.warn('invalid order', { item, qty });
        return json(400, { error: 'item required, qty must be 1..100' });
      }
      span.addEvent('validation.passed');
      const res = await fetch(`${pricingUrl}/price?item=${encodeURIComponent(item)}`);
      const priceInfo = await res.json();
      if (!res.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `pricing failed: ${res.status}` });
        log.error('pricing lookup failed', { item, status: res.status });
        return json(422, { error: priceInfo.error || 'pricing failed' });
      }
      span.addEvent('price.received', { 'app.unit_price': priceInfo.price });
      const total = priceInfo.price * qty;
      const sql = 'INSERT INTO orders (item, qty, unit_price, total, created_at) VALUES (?, ?, ?, ?, ?)';
      const r = await dbSpan('INSERT', sql, () => db.prepare(sql).run(item, qty, priceInfo.price, total, new Date().toISOString()));
      const id = Number(r.lastInsertRowid);
      span.setAttribute('app.order_id', id);
      span.addEvent('order.persisted', { 'app.order_id': id, 'app.total': total });
      log.info('order created', { order_id: id, item, qty, total });
      return json(201, { id, item, qty, unit_price: priceInfo.price, total, currency: 'TWD' });
    });
  });

  route('GET', '/orders/report', async ({ query, json }) => {
    const ms = Math.min(Math.max(Number(query.get('ms') || 1200), 0), 10000);
    return withSpan(tracer, 'orders.report', { attributes: { 'app.simulated_delay_ms': ms } }, async (span) => {
      const sql = 'SELECT item, COUNT(*) AS n, SUM(total) AS revenue FROM orders GROUP BY item ORDER BY revenue DESC';
      const rows = await withSpan(tracer, 'report.aggregate', {}, async (inner) => {
        // Deliberately slow path: simulated heavy aggregation.
        await sleep(ms);
        inner.addEvent('aggregation.finished', { 'app.elapsed_ms': ms });
        return dbSpan('SELECT', sql, () => db.prepare(sql).all());
      });
      if (ms >= 500) {
        span.addEvent('report.slow', { 'app.threshold_ms': 500, 'app.elapsed_ms': ms });
        log.warn('slow report generated', { elapsed_ms: ms, rows: rows.length });
      }
      return json(200, { elapsed_ms: ms, rows });
    });
  });

  route('GET', '/orders/fail', async () => {
    // The thrown error propagates to the base router, which marks the SERVER span as ERROR and returns 500.
    await withSpan(tracer, 'orders.charge', { attributes: { 'app.payment.provider': 'demo-pay' } }, async (span) => {
      span.addEvent('payment.attempt', { 'app.attempt': 1 });
      await sleep(40);
      // Deliberate error path. The log is written inside the span, so it is correlated with orders.charge.
      const err = new Error('payment provider timeout (simulated)');
      log.error('charge failed', { error: err.message, provider: 'demo-pay' });
      throw err;
    });
  });

  route('GET', '/orders/:id', async ({ params, json }) => {
    const sql = 'SELECT * FROM orders WHERE id = ?';
    const row = await dbSpan('SELECT', sql, () => db.prepare(sql).get(Number(params.id)));
    if (!row) { log.info('order not found', { order_id: params.id }); return json(404, { error: 'order not found' }); }
    return json(200, row);
  });
});
