// HTTP layer (node:http, no framework). JSON API + static files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createPasskeyService, AppError } from './passkeys.js';
import { PROJECT_ROOT } from './config.js';

const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' };
const SESSION_COOKIE = 'pk_sid';
const FLOW_COOKIE = 'pk_flow';
const sha256 = s => createHash('sha256').update(s).digest('hex');

export async function createApp({ cfg, store, log }) {
  const svc = createPasskeyService({ store, cfg, log });

  const cookieAttrs = (maxAgeSec, sameSite = 'Lax') =>
    `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}${cfg.secureCookies ? '; Secure' : ''}`;

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  async function readJson(req, limit = 64 * 1024) {
    const ct = req.headers['content-type'] || '';
    if (!ct.startsWith('application/json')) throw new AppError('BAD_REQUEST', 415, 'Content-Type must be application/json');
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw new AppError('BAD_REQUEST', 413, 'Body too large'); chunks.push(c); }
    try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
    catch { throw new AppError('BAD_REQUEST', 400, 'Invalid JSON'); }
  }

  function send(res, status, body, headers = {}) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  }

  function securityHeaders(res) {
    // CSP allows only same-origin scripts/styles; it does not interfere with Chrome DevTools.
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    // publickey-credentials-* default to 'self' already; stated explicitly for clarity.
    res.setHeader('Permissions-Policy', 'publickey-credentials-get=(self), publickey-credentials-create=(self)');
  }

  async function currentSession(req) {
    const tok = parseCookies(req)[SESSION_COOKIE];
    if (!tok) return null;
    const s = await store.getSession(sha256(tok));
    if (!s) return null;
    const user = await store.getUserById(s.user_id);
    return user ? { user, tokenHash: sha256(tok), credentialId: s.credential_id } : null;
  }

  function flowId(req, res) {
    let id = parseCookies(req)[FLOW_COOKIE];
    if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
      id = randomBytes(18).toString('base64url');
      res.appendHeader('Set-Cookie', `${FLOW_COOKIE}=${id}; ${cookieAttrs(Math.ceil(cfg.challengeTtlMs / 1000), 'Strict')}`);
    }
    return id;
  }

  async function startSession(res, user, credentialId) {
    const tok = randomBytes(32).toString('base64url');
    await store.createSession(sha256(tok), user.id, credentialId, cfg.sessionTtlMs);
    res.appendHeader('Set-Cookie', `${SESSION_COOKIE}=${tok}; ${cookieAttrs(Math.floor(cfg.sessionTtlMs / 1000))}`);
  }

  const ctxOf = req => ({ ip: req.socket.remoteAddress, userAgent: req.headers['user-agent'] });

  function checkOrigin(req) {
    // CSRF + misconfiguration guard for state-changing requests.
    const origin = req.headers.origin;
    if (origin && !cfg.origins.includes(origin)) {
      throw new AppError('ORIGIN_MISMATCH', 403, `Request origin ${origin} is not allowed. Open the site at ${cfg.origins[0]} (rpID ${cfg.rpID}) or start the server with --origin ${origin}`, { expected: cfg.origins });
    }
  }

  async function requireUser(req) {
    const s = await currentSession(req);
    if (!s) throw new AppError('NOT_AUTHENTICATED', 401, 'Please sign in');
    return s;
  }

  async function api(req, res, url) {
    const m = req.method, p = url.pathname;
    if (m !== 'GET' && m !== 'HEAD') checkOrigin(req);

    if (m === 'GET' && p === '/api/config') return send(res, 200, { rpID: cfg.rpID, rpName: cfg.rpName, origins: cfg.origins, debug: cfg.debug, requireUV: cfg.requireUV });
    if (m === 'GET' && p === '/api/me') {
      const s = await currentSession(req);
      if (!s) return send(res, 200, { user: null });
      return send(res, 200, { user: { username: s.user.username, displayName: s.user.displayName, createdAt: s.user.createdAt }, currentCredentialId: s.credentialId });
    }
    if (m === 'POST' && p === '/api/register/options') {
      const body = await readJson(req);
      const s = await currentSession(req);
      const options = await svc.registrationOptions({ flowId: flowId(req, res), sessionUser: s?.user, username: body.username, displayName: body.displayName });
      await store.audit({ userId: s?.user.id, username: s?.user.username ?? body.username, event: 'register.options', ok: true, ...ctxOf(req) });
      return send(res, 200, options);
    }
    if (m === 'POST' && p === '/api/register/verify') {
      const body = await readJson(req);
      const s = await currentSession(req);
      try {
        const r = await svc.verifyRegistration({ flowId: flowId(req, res), response: body.response, name: body.name });
        await store.audit({ userId: r.user.id, username: r.user.username, event: s ? 'passkey.add' : 'register', ok: true, credentialId: r.passkey.id, detail: r.passkey.authenticator, ...ctxOf(req) });
        if (!s) await startSession(res, r.user, r.passkey.id);
        return send(res, 200, { ok: true, passkey: r.passkey });
      } catch (err) {
        await store.audit({ userId: s?.user.id, username: s?.user.username, event: s ? 'passkey.add' : 'register', ok: false, detail: `${err.code || 'ERROR'}: ${err.message}`.slice(0, 300), ...ctxOf(req) });
        throw err;
      }
    }
    if (m === 'POST' && p === '/api/login/options') {
      const body = await readJson(req);
      return send(res, 200, await svc.authenticationOptions({ flowId: flowId(req, res), username: body.username }));
    }
    if (m === 'POST' && p === '/api/login/verify') {
      const body = await readJson(req);
      try {
        const r = await svc.verifyAuthentication({ flowId: flowId(req, res), response: body.response });
        await startSession(res, r.user, r.passkey.id);
        await store.audit({ userId: r.user.id, username: r.user.username, event: 'login', ok: true, credentialId: r.passkey.id, detail: `counter=${r.counter} uv=${r.userVerified}`, ...ctxOf(req) });
        return send(res, 200, { ok: true, user: { username: r.user.username, displayName: r.user.displayName }, passkey: r.passkey });
      } catch (err) {
        const u = err.extra?.user;
        await store.audit({ userId: u?.id, username: u?.username, event: 'login', ok: false, credentialId: err.extra?.credentialId ?? body?.response?.id, detail: `${err.code || 'ERROR'}: ${err.message}`.slice(0, 300), ...ctxOf(req) });
        if (err.extra) err.extra = { credentialId: err.extra.credentialId };
        throw err;
      }
    }
    if (m === 'POST' && p === '/api/logout') {
      const s = await currentSession(req);
      if (s) { await store.deleteSession(s.tokenHash); await store.audit({ userId: s.user.id, username: s.user.username, event: 'logout', ok: true, ...ctxOf(req) }); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; ${cookieAttrs(0)}` });
    }
    if (m === 'GET' && p === '/api/passkeys') {
      const s = await requireUser(req);
      return send(res, 200, { passkeys: await svc.listPasskeys(s.user.id), currentCredentialId: s.credentialId });
    }
    const pk = p.match(/^\/api\/passkeys\/([A-Za-z0-9_-]+)$/);
    if (pk && m === 'PATCH') {
      const s = await requireUser(req);
      const body = await readJson(req);
      const name = await svc.renamePasskey(s.user.id, pk[1], body.name);
      await store.audit({ userId: s.user.id, username: s.user.username, event: 'passkey.rename', ok: true, credentialId: pk[1], detail: name, ...ctxOf(req) });
      return send(res, 200, { ok: true });
    }
    if (pk && m === 'DELETE') {
      const s = await requireUser(req);
      try {
        await svc.deletePasskey(s.user.id, pk[1]);
        await store.audit({ userId: s.user.id, username: s.user.username, event: 'passkey.delete', ok: true, credentialId: pk[1], ...ctxOf(req) });
      } catch (err) {
        await store.audit({ userId: s.user.id, username: s.user.username, event: 'passkey.delete', ok: false, credentialId: pk[1], detail: err.code, ...ctxOf(req) });
        throw err;
      }
      return send(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/audit') {
      const s = await requireUser(req);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      return send(res, 200, { events: await store.listAudit(s.user.id, limit) });
    }
    if (m === 'GET' && p === '/api/debug/ceremonies') {
      if (!cfg.debug) throw new AppError('NOT_FOUND', 404, 'Debug endpoints require --debug');
      return send(res, 200, { ceremonies: svc.debugCeremonies(), recentAudit: await store.listAudit(null, 30) });
    }
    throw new AppError('NOT_FOUND', 404, 'Unknown API');
  }

  async function serveStatic(req, res, url) {
    let p = url.pathname;
    if (p === '/' || p === '/account' || p === '/debug') p = '/index.html';
    const file = normalize(join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: { code: 'FORBIDDEN' } });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://x');
    securityHeaders(res);
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (err) {
      const status = err instanceof AppError ? err.status : 500;
      const code = err instanceof AppError ? err.code : 'INTERNAL';
      const level = status >= 500 ? 'error' : 'warn';
      log[level]('request.error', { method: req.method, path: url.pathname, code, message: err.message, ...(status >= 500 ? { stack: err.stack } : {}) });
      if (!res.headersSent) send(res, status, { error: { code, message: status >= 500 ? 'Internal error' : err.message, ...(err.extra || {}) } });
    } finally {
      log.debug('http', { method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started });
    }
  });

  return {
    server, svc,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(cfg.port, cfg.host, () => resolve(server.address().port));
    }),
    close: () => new Promise(r => server.close(() => r())),
  };
}
