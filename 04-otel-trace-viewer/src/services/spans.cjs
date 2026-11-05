'use strict';
// Helper for manual spans: runs fn inside an active span, records exceptions and always ends the span.
const api = require('@opentelemetry/api');

async function withSpan(tracer, name, options, fn) {
  return tracer.startActiveSpan(name, options || {}, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { withSpan, sleep, SpanKind: api.SpanKind, SpanStatusCode: api.SpanStatusCode };
