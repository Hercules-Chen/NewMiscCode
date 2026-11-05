'use strict';
// "pricing" service: leaf service called by orders through fetch(). Small random latency.
const { runService } = require('./base.cjs');
const { withSpan, sleep, SpanStatusCode } = require('./spans.cjs');

const CATALOG = { widget: 120, gadget: 450, gizmo: 80, doohickey: 999 };

runService('pricing', ({ route, tracer, log }) => {
  route('GET', '/price', async ({ query, json }) => {
    const item = String(query.get('item') || '');
    const result = await withSpan(tracer, 'pricing.lookup', { attributes: { 'app.item': item } }, async (span) => {
      await sleep(5 + Math.floor(Math.random() * 25));
      const price = CATALOG[item];
      if (price === undefined) {
        span.addEvent('catalog.miss', { 'app.item': item });
        span.setStatus({ code: SpanStatusCode.ERROR, message: `unknown item: ${item}` });
        log.warn('unknown item requested', { item });
        return null;
      }
      span.setAttribute('app.price', price);
      span.addEvent('catalog.hit', { 'app.price': price });
      return price;
    });
    if (result === null) return json(404, { error: `unknown item: ${item}` });
    log.info('price looked up', { item, price: result });
    return json(200, { item, price: result, currency: 'TWD' });
  });
});
