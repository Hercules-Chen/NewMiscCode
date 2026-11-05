'use strict';
// "gateway" service: public entry point. Calls orders with fetch(); W3C traceparent is injected by the undici instrumentation.
const { runService } = require('./base.cjs');
const { withSpan, SpanStatusCode } = require('./spans.cjs');

runService('gateway', ({ route, tracer, log, args, api }) => {
  const ordersUrl = String(args.orders || process.env.OTV_ORDERS_URL || 'http://127.0.0.1:3402').replace(/\/$/, '');

  async function forward(span, path, init) {
    const res = await fetch(`${ordersUrl}${path}`, init);
    const data = await res.json().catch(() => ({}));
    span.setAttribute('app.downstream.status', res.status);
    if (res.status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `orders responded ${res.status}: ${data.error || ''}` });
      log.error('downstream failure', { path, status: res.status, error: data.error });
    }
    return { status: res.status, data };
  }

  route('GET', '/', async ({ json }) => json(200, {
    service: 'gateway',
    endpoints: ['GET /api/checkout?item=widget&qty=2', 'GET /api/orders/:id', 'GET /api/slow?ms=1200', 'GET /api/error'],
  }));

  route('GET', '/api/checkout', async ({ query, json }) => {
    const item = String(query.get('item') || 'widget');
    const qty = Number(query.get('qty') || 1);
    const serverSpan = api.trace.getActiveSpan();
    serverSpan?.setAttribute('app.item', item);
    const r = await withSpan(tracer, 'checkout.handle', { attributes: { 'app.item': item, 'app.qty': qty } }, async (span) => {
      span.addEvent('checkout.started');
      const out = await forward(span, '/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item, qty }) });
      span.addEvent('checkout.finished', { 'app.status': out.status });
      return out;
    });
    if (r.status >= 500) serverSpan?.setStatus({ code: SpanStatusCode.ERROR, message: 'checkout failed' });
    log.info('checkout handled', { item, qty, status: r.status });
    return json(r.status, r.data);
  });

  route('GET', '/api/orders/:id', async ({ params, json }) => {
    const r = await withSpan(tracer, 'orders.fetch', { attributes: { 'app.order_id': params.id } }, (span) => forward(span, `/orders/${encodeURIComponent(params.id)}`));
    return json(r.status, r.data);
  });

  route('GET', '/api/slow', async ({ query, json }) => {
    const ms = Number(query.get('ms') || 1200);
    const r = await withSpan(tracer, 'report.request', { attributes: { 'app.simulated_delay_ms': ms } }, (span) => forward(span, `/orders/report?ms=${ms}`));
    log.info('report served', { ms });
    return json(r.status, r.data);
  });

  route('GET', '/api/error', async ({ json }) => {
    const serverSpan = api.trace.getActiveSpan();
    const r = await withSpan(tracer, 'payment.request', {}, (span) => forward(span, '/orders/fail'));
    serverSpan?.setStatus({ code: SpanStatusCode.ERROR, message: `payment failed (${r.status})` });
    return json(502, { error: 'payment failed', downstream: r.data });
  });
});
