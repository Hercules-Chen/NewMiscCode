/*
 * Deterministic sample-data generator (shared by the browser app and the Node build/test).
 * Plain script: attaches `SampleGen` to globalThis. Works as a classic <script> and when
 * imported for side effects from Node ESM.
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MODULES = [
    { name: 'auth', base: 35 },
    { name: 'api.gateway', base: 60 },
    { name: 'billing', base: 180 },
    { name: 'db.pool', base: 90 },
    { name: 'search', base: 260 },
    { name: 'notifier', base: 45 },
    { name: 'scheduler', base: 120 },
    { name: 'export', base: 650 }
  ];

  const MESSAGES = {
    DEBUG: ['cache lookup', 'request payload parsed', 'feature flag evaluated', 'retry budget checked'],
    INFO: ['request completed', 'user signed in', 'job finished', 'report generated', 'invoice created', 'search served'],
    WARN: ['slow query detected', 'retrying upstream call', 'cache miss ratio high', 'rate limit approaching'],
    ERROR: [
      'database connection timeout',
      'upstream service returned 503',
      'payment provider declined request',
      'null reference in report builder',
      '資料庫連線逾時 (DB connection timeout)',
      'permission denied for resource'
    ]
  };

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  function fmtTs(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '.' + pad(d.getUTCMilliseconds(), 3);
  }

  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

  /**
   * Generate an app log as an array of plain objects.
   * Fields: timestamp, level, module, message, elapsed_ms, request_id, user_id
   */
  function generateLogRecords(opts) {
    const o = Object.assign({ count: 3000, seed: 42, start: Date.UTC(2026, 10, 1, 0, 0, 0), hours: 48 }, opts || {});
    const rnd = mulberry32(o.seed);
    const span = o.hours * 3600 * 1000;
    const times = [];
    for (let i = 0; i < o.count; i++) times.push(o.start + Math.floor(rnd() * span));
    times.sort((a, b) => a - b);
    const spikeStart = o.start + 30 * 3600 * 1000; // error spike between hour 30 and 32
    const spikeEnd = spikeStart + 2 * 3600 * 1000;
    const out = [];
    for (let i = 0; i < o.count; i++) {
      const t = times[i];
      const mod = pick(rnd, MODULES);
      const inSpike = t >= spikeStart && t < spikeEnd && (mod.name === 'db.pool' || mod.name === 'billing');
      const r = rnd();
      let level;
      if (inSpike && r < 0.6) level = 'ERROR';
      else if (r < 0.25) level = 'DEBUG';
      else if (r < 0.80) level = 'INFO';
      else if (r < 0.93) level = 'WARN';
      else level = 'ERROR';
      // log-normal-ish latency per module
      const u = Math.max(1e-6, rnd());
      const v = rnd();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      let elapsed = Math.round(mod.base * Math.exp(0.6 * z) * (level === 'ERROR' ? 2.5 : 1));
      if (elapsed < 1) elapsed = 1;
      const message = pick(rnd, MESSAGES[level]);
      out.push({
        timestamp: fmtTs(t),
        level: level,
        module: mod.name,
        message: message,
        elapsed_ms: elapsed,
        request_id: 'req-' + (100000 + i).toString(16),
        user_id: 1 + Math.floor(rnd() * 250)
      });
    }
    return out;
  }

  function generateLogJsonl(opts) {
    return generateLogRecords(opts).map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  function generateSalesCsv() {
    const rnd = mulberry32(7);
    const regions = ['North', 'South', 'East', 'West', '台北'];
    const products = ['Widget', 'Gadget', 'Doohickey', 'Gizmo'];
    const lines = ['order_id,order_date,region,product,qty,unit_price'];
    for (let i = 1; i <= 400; i++) {
      const day = 1 + Math.floor(rnd() * 28);
      const month = 1 + Math.floor(rnd() * 10);
      const qty = 1 + Math.floor(rnd() * 20);
      const price = (5 + Math.floor(rnd() * 9500) / 100).toFixed(2);
      lines.push([i, '2026-' + pad(month) + '-' + pad(day), pick(rnd, regions), pick(rnd, products), qty, price].join(','));
    }
    return lines.join('\n') + '\n';
  }

  root.SampleGen = { generateLogRecords, generateLogJsonl, generateSalesCsv, fmtTs };
})(typeof globalThis !== 'undefined' ? globalThis : window);
