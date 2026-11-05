// 訂單處理 saga：預留庫存 → 扣款 → 出貨；任何一步永久失敗時，依相反順序補償（退款 → 釋放庫存）。
// Order processing saga: reserve stock -> charge -> ship, compensating in reverse on failure.
//
// Input: { orderId, sku, qty, amount, simulate?: { chargeFailures?: number, shipFails?: boolean, delayMs?: number } }
//  - chargeFailures: the charge activity throws a transient error this many times (retry demo)
//  - shipFails: the ship activity throws a NonRetryableError (compensation demo)
import { defineWorkflow } from '../engine.js';
import { NonRetryableError, CancelledError } from '../errors.js';
import { Saga } from '../saga.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

export const orderSaga = defineWorkflow({
  name: 'order-saga',
  version: '1',
  title: { 'zh-TW': '訂單處理 Saga（預留庫存→扣款→出貨，失敗補償）', en: 'Order saga (reserve → charge → ship, with compensation)' },
  sampleInput: { orderId: 'SO-1001', sku: 'NB-14', qty: 2, amount: 52000, simulate: { chargeFailures: 1, shipFails: false, delayMs: 300 } },
  async handler(ctx, input) {
    const sim = input.simulate || {};
    const delay = sim.delayMs ?? 300;
    const saga = new Saga(ctx);
    try {
      const reservation = await ctx.step('reserveStock', async a => {
        await wait(delay);
        a.log('stock reserved', { sku: input.sku, qty: input.qty });
        return { reservationId: `RSV-${input.orderId}`, sku: input.sku, qty: input.qty };
      });
      saga.add('releaseStock', async () => { await wait(delay / 2); return { released: reservation.reservationId }; });

      const payment = await ctx.step('chargePayment', async a => {
        await wait(delay);
        if (a.attempt <= (sim.chargeFailures || 0)) throw new Error(`payment gateway timeout (simulated, attempt ${a.attempt})`);
        return { paymentId: `PAY-${input.orderId}`, amount: input.amount, idempotencyKey: a.idempotencyKey };
      }, { retry: { maxAttempts: 4, initialIntervalMs: 500, backoffCoefficient: 2 } });
      saga.add('refundPayment', async () => { await wait(delay / 2); return { refunded: payment.paymentId, amount: payment.amount }; });

      const shipment = await ctx.step('shipOrder', async () => {
        await wait(delay);
        if (sim.shipFails) throw new NonRetryableError('address not deliverable (simulated)');
        return { trackingNo: `TW${String(input.orderId).replace(/\D/g, '')}88` };
      });

      await ctx.step('notifyCustomer', async () => ({ sent: true, channel: 'email' }));
      return { status: 'shipped', reservation, payment, shipment };
    } catch (err) {
      ctx.log('order failed; compensating', { reason: err.message });
      const compensated = await saga.compensate();
      if (err instanceof CancelledError) throw err;
      return { status: 'compensated', reason: err.message, compensated };
    }
  },
});
