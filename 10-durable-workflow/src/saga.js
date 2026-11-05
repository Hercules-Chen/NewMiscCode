// Saga helper: register a compensation after each successful step; on failure run them
// in reverse order, each compensation itself being a durable ctx.step().
export class Saga {
  constructor(ctx, { retry } = {}) { this.ctx = ctx; this.compensations = []; this.retry = retry || { maxAttempts: 5, initialIntervalMs: 200 }; }
  add(name, fn) { this.compensations.push({ name, fn }); }
  async compensate() {
    const done = [];
    for (const c of [...this.compensations].reverse()) {
      await this.ctx.step(c.name, c.fn, { retry: this.retry });
      done.push(c.name);
    }
    return done;
  }
}
