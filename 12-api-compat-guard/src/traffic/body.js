// HTTP 本文編解碼（錄製檔格式）。 Body encoding for recordings.
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip), inflate = promisify(zlib.inflate), brotli = promisify(zlib.brotliDecompress);

export async function decodeContent(buf, encoding) {
  const e = String(encoding || '').toLowerCase();
  try {
    if (e === 'gzip') return await gunzip(buf);
    if (e === 'deflate') return await inflate(buf);
    if (e === 'br') return await brotli(buf);
  } catch { /* 原樣保留 keep raw */ }
  return buf;
}

export const isJsonType = ct => /[/+]json\b/i.test(String(ct || ''));
export const isTextType = ct => /^text\/|xml|javascript|x-www-form-urlencoded/i.test(String(ct || ''));

/** buffer -> { kind: 'json'|'text'|'base64'|'empty', value } */
export function encodeBody(buf, contentType) {
  if (!buf || buf.length === 0) return { kind: 'empty' };
  const text = buf.toString('utf8');
  if (isJsonType(contentType) || (!contentType && /^\s*[{[]/.test(text))) {
    try { return { kind: 'json', value: JSON.parse(text) }; } catch { /* fallthrough */ }
  }
  if (isTextType(contentType) || !contentType) return { kind: 'text', value: text };
  return { kind: 'base64', value: buf.toString('base64') };
}

export function bodyToBuffer(body) {
  if (!body || body.kind === 'empty') return Buffer.alloc(0);
  if (body.kind === 'json') return Buffer.from(JSON.stringify(body.value), 'utf8');
  if (body.kind === 'base64') return Buffer.from(body.value, 'base64');
  return Buffer.from(String(body.value), 'utf8');
}

export function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host', 'content-length']);
