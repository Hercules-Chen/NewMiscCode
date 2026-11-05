// 重播：把錄製的請求送到「新服務」並比對回應。 Replay recorded requests against the NEW service.
import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { compareExchange, effectiveOptions } from './compare.js';
import { bodyToBuffer, decodeContent, encodeBody, readStream, HOP_BY_HOP } from './body.js';
import { REDACTED } from './redact.js';
import { nullLogger } from '../env.js';

export async function readRecordings(file) {
  const out = [];
  const rl = readline.createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    const t = line.replace(/^﻿/, '').trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch (e) { throw new Error(`${file}:${n}: invalid JSON line (${e.message})`); }
  }
  return out;
}

const expandEnv = v => String(v).replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');

async function send(base, rec, opts) {
  const url = new URL(rec.request.url, base.href.endsWith('/') ? base.href : base.href + '/');
  // 保留 base 的路徑前綴 keep base path prefix
  const prefix = base.pathname.replace(/\/$/, '');
  const path = prefix + rec.request.url;
  const lib = url.protocol === 'https:' ? https : http;
  const headers = {};
  for (const [k, v] of Object.entries(rec.request.headers || {})) {
    if (HOP_BY_HOP.has(k.toLowerCase()) || v === REDACTED || k.toLowerCase() === 'accept-encoding') continue;
    headers[k] = v;
  }
  for (const [k, v] of Object.entries(opts.injectHeaders || {})) headers[k] = expandEnv(v);
  const body = bodyToBuffer(rec.request.body);
  headers['content-length'] = String(body.length);
  headers['accept-encoding'] = 'identity';
  const res = await new Promise((resolve, reject) => {
    const r = lib.request({ protocol: base.protocol, hostname: base.hostname, port: base.port, method: rec.request.method, path, headers }, resolve);
    r.on('error', reject);
    r.setTimeout(opts.timeoutMs || 15000, () => r.destroy(new Error('timeout')));
    r.end(body);
  });
  const buf = await decodeContent(await readStream(res), res.headers['content-encoding']);
  return { status: res.statusCode, headers: res.headers, body: encodeBody(buf, res.headers['content-type']) };
}

/**
 * @returns {Promise<{exchanges:object[], findings:object[]}>}
 */
export async function replay({ to, recordings, options = {}, logger = nullLogger, redactor = null }) {
  const base = new URL(to);
  const exchanges = [], findings = [];
  for (const rec of recordings) {
    const method = rec.request.method, url = rec.request.url;
    const opt = effectiveOptions(options, method, url);
    let actual, diffs;
    const t0 = Date.now();
    try {
      actual = await send(base, rec, opt);
      if (redactor && actual.body.kind === 'json') actual.body.value = redactor.redactJson(actual.body.value);
      diffs = compareExchange(rec.response, actual, opt);
    } catch (e) {
      diffs = [{ rule: 'REQUEST_FAILED', severity: 'BREAKING', field: '-', message: { 'zh-TW': `無法呼叫新服務：${e.message}`, en: `Request to new service failed: ${e.message}` }, params: { detail: e.message } }];
    }
    const sev = diffs.some(d => d.severity === 'BREAKING') ? 'BREAKING' : diffs.some(d => d.severity === 'NON_BREAKING') ? 'NON_BREAKING' : diffs.length ? 'INFO' : 'OK';
    const ex = { id: rec.id, method, url, oldStatus: rec.response.status, newStatus: actual?.status ?? null, severity: sev, ms: Date.now() - t0, diffs, newBody: actual?.body };
    exchanges.push(ex);
    for (const d of diffs) findings.push({ ...d, location: `${method} ${url}`, exchangeId: rec.id });
    logger.info('replay.exchange', { id: rec.id, method, url, oldStatus: ex.oldStatus, newStatus: ex.newStatus, diffs: diffs.length, severity: sev });
  }
  return { exchanges, findings };
}
