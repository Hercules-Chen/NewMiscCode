// 錄製用反向代理：放在「舊服務」前面，把請求/回應寫成 JSONL。
// Recording reverse proxy in front of the OLD service; writes request/response pairs to JSONL.
import http from 'node:http';
import https from 'node:https';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeRedactor } from './redact.js';
import { decodeContent, encodeBody, readStream, HOP_BY_HOP } from './body.js';
import { nullLogger } from '../env.js';

function forwardHeaders(h, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(h)) if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  return { ...out, ...extra };
}

/**
 * @param {{target:string, port?:number, host?:string, out:string, redact?:object, logger?:object, exclude?:string[]}} opts
 */
export async function startRecorder(opts) {
  const target = new URL(opts.target);
  const lib = target.protocol === 'https:' ? https : http;
  const redactor = makeRedactor(opts.redact || {});
  const log = opts.logger || nullLogger;
  const exclude = (opts.exclude || []).map(p => new RegExp(p));
  let writeQueue = Promise.resolve();
  let count = 0;
  await mkdir(dirname(opts.out), { recursive: true });

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const id = randomUUID();
    try {
      const reqBuf = await readStream(req);
      const basePath = target.pathname.replace(/\/$/, '');
      const upstreamPath = basePath + req.url;
      const upHeaders = forwardHeaders(req.headers, { host: target.host, 'accept-encoding': 'identity', 'content-length': String(reqBuf.length) });
      log.debug('proxy.request', { id, method: req.method, url: redactor.redactUrl(req.url) });
      const upRes = await new Promise((resolve, reject) => {
        const r = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: upstreamPath, headers: upHeaders }, resolve);
        r.on('error', reject);
        r.setTimeout(opts.timeoutMs || 30000, () => r.destroy(new Error('upstream timeout')));
        r.end(reqBuf);
      });
      const resBuf = await readStream(upRes);
      const outHeaders = forwardHeaders(upRes.headers, { 'content-length': String(resBuf.length) });
      res.writeHead(upRes.statusCode, outHeaders);
      res.end(resBuf);

      if (exclude.some(rx => rx.test(req.url))) return;
      const decoded = await decodeContent(resBuf, upRes.headers['content-encoding']);
      const reqBody = encodeBody(reqBuf, req.headers['content-type']);
      const resBody = encodeBody(decoded, upRes.headers['content-type']);
      if (reqBody.kind === 'json') reqBody.value = redactor.redactJson(reqBody.value);
      if (resBody.kind === 'json') resBody.value = redactor.redactJson(resBody.value);
      const rec = {
        v: 1, id, ts: new Date(started).toISOString(), durationMs: Date.now() - started,
        request: { method: req.method, url: redactor.redactUrl(req.url), headers: redactor.redactHeaders(forwardHeaders(req.headers)), body: reqBody },
        response: { status: upRes.statusCode, headers: redactor.redactHeaders(forwardHeaders(upRes.headers)), body: resBody }
      };
      const line = JSON.stringify(rec) + '\n';
      writeQueue = writeQueue.then(() => appendFile(opts.out, line, 'utf8')).then(() => { count++; });
      await writeQueue;
      log.info('proxy.recorded', { id, method: req.method, url: rec.request.url, status: upRes.statusCode, ms: rec.durationMs });
    } catch (e) {
      log.error('proxy.error', { id, error: e.message });
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'apiguard proxy: upstream error', detail: e.message }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 0, opts.host || '127.0.0.1', resolve); });
  const port = server.address().port;
  log.info('proxy.listening', { port, target: target.origin, out: opts.out });
  return {
    server, port,
    count: () => count,
    flush: () => writeQueue,
    close: async () => { await writeQueue; server.closeAllConnections?.(); await new Promise(r => server.close(r)); }
  };
}
