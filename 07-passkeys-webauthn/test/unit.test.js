import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/db.js';
import { createPasskeyService, safeDecode } from '../src/passkeys.js';
import { defaultDataDir, validateConfig, loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { createSoftAuthenticator } from './soft-authenticator.js';

const ORIGIN = 'http://localhost:3007';
const silent = { debug() {}, info() {}, warn() {}, error() {}, debugEnabled: false };
const baseCfg = { rpID: 'localhost', rpName: 'Test', origins: [ORIGIN], debug: true, requireUV: false, challengeTtlMs: 60000, sessionTtlMs: 60000 };

async function setup(cfgOverrides = {}) {
  const store = await openStore(':memory:');
  const cfg = { ...baseCfg, ...cfgOverrides };
  return { store, cfg, svc: createPasskeyService({ store, cfg, log: silent }), auth: createSoftAuthenticator({ origin: ORIGIN }) };
}
const rejects = (p, code) => assert.rejects(p, err => { assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`); return true; });

async function registerUser(ctx, username = 'alice', flowId = 'flow-aaaaaaaaaaaaaaaaaaaa') {
  const opts = await ctx.svc.registrationOptions({ flowId, username, displayName: 'Alice' });
  return ctx.svc.verifyRegistration({ flowId, response: ctx.auth.register(opts) });
}

test('config: OS-aware default data dir', () => {
  assert.equal(defaultDataDir('win32', { ProgramData: 'C:\\ProgramData' }), 'C:\\ProgramData/NewMiscCode/07-passkeys-webauthn'.replace(/\//g, process.platform === 'win32' ? '\\' : '/'));
  assert.match(defaultDataDir('linux', {}), /07-passkeys-webauthn[\\/]data$/);
});

test('config: rpID must match origin host; http only for localhost', () => {
  assert.ok(validateConfig({ rpID: 'example.com', origins: ['https://login.example.com'] }));
  assert.throws(() => validateConfig({ rpID: 'example.com', origins: ['https://example.org'] }), /registrable suffix/);
  assert.throws(() => validateConfig({ rpID: 'example.com', origins: ['http://example.com'] }), /https/);
  const cfg = loadConfig(['--port', '4000'], {});
  assert.deepEqual(cfg.origins, ['http://localhost:4000']);
  assert.equal(cfg.secureCookies, false);
  assert.equal(loadConfig(['--rp-id', 'example.com', '--origin', 'https://example.com'], {}).secureCookies, true);
});

test('registration: creates user + discoverable credential (attestation none)', async () => {
  const ctx = await setup();
  const opts = await ctx.svc.registrationOptions({ flowId: 'f1-xxxxxxxxxxxxxxxxxxxx', username: 'alice' });
  assert.equal(opts.attestation, 'none');
  assert.equal(opts.authenticatorSelection.residentKey, 'required');
  assert.equal(opts.rp.id, 'localhost');
  const r = await ctx.svc.verifyRegistration({ flowId: 'f1-xxxxxxxxxxxxxxxxxxxx', response: ctx.auth.register(opts), name: 'Laptop' });
  assert.equal(r.user.username, 'alice');
  assert.equal(r.passkey.name, 'Laptop');
  assert.equal(r.passkey.fmt, 'none');
  assert.equal(r.passkey.aaguid, '7e570000-0000-0000-0000-000000000001');
  assert.deepEqual(r.passkey.transports, ['internal']);
  assert.equal(r.passkey.publicKey, undefined, 'public key bytes are not exposed by the API');
  assert.equal((await ctx.store.listCredentials(r.user.id)).length, 1);
});

test('registration: username validation and duplicates', async () => {
  const ctx = await setup();
  await rejects(ctx.svc.registrationOptions({ flowId: 'f', username: 'a' }), 'USERNAME_INVALID');
  await registerUser(ctx);
  await rejects(ctx.svc.registrationOptions({ flowId: 'f', username: 'ALICE' }), 'USERNAME_TAKEN');
});

test('challenge: single use and expiry', async () => {
  const ctx = await setup();
  const opts = await ctx.svc.registrationOptions({ flowId: 'f2', username: 'bob' });
  const resp = ctx.auth.register(opts);
  await ctx.svc.verifyRegistration({ flowId: 'f2', response: resp });
  await rejects(ctx.svc.verifyRegistration({ flowId: 'f2', response: resp }), 'CHALLENGE_MISSING');

  const ctx2 = await setup({ challengeTtlMs: -1 });
  const o2 = await ctx2.svc.registrationOptions({ flowId: 'f3', username: 'carol' });
  await rejects(ctx2.svc.verifyRegistration({ flowId: 'f3', response: ctx2.auth.register(o2) }), 'CHALLENGE_EXPIRED');
});

test('registration: wrong origin in clientDataJSON is rejected', async () => {
  const ctx = await setup();
  const opts = await ctx.svc.registrationOptions({ flowId: 'f4', username: 'dave' });
  await rejects(ctx.svc.verifyRegistration({ flowId: 'f4', response: ctx.auth.register(opts, { originOverride: 'https://evil.example' }) }), 'ORIGIN_MISMATCH');
  assert.equal(await ctx.store.getUserByName('dave'), undefined);
});

test('login: usernameless + counter increments + counter regression rejected', async () => {
  const ctx = await setup();
  const reg = await registerUser(ctx);
  const o1 = await ctx.svc.authenticationOptions({ flowId: 'L1' });
  assert.deepEqual(o1.allowCredentials, []);
  const r1 = await ctx.svc.verifyAuthentication({ flowId: 'L1', response: ctx.auth.authenticate(o1) });
  assert.equal(r1.user.username, 'alice');
  assert.equal(r1.counter, 1);
  const o2 = await ctx.svc.authenticationOptions({ flowId: 'L1' });
  const r2 = await ctx.svc.verifyAuthentication({ flowId: 'L1', response: ctx.auth.authenticate(o2) });
  assert.equal(r2.counter, 2);
  assert.equal((await ctx.store.getCredential(reg.passkey.id)).counter, 2);
  assert.ok(r2.passkey.lastUsedAt);
  const o3 = await ctx.svc.authenticationOptions({ flowId: 'L1' });
  await rejects(ctx.svc.verifyAuthentication({ flowId: 'L1', response: ctx.auth.authenticate(o3, { counter: 2 }) }), 'COUNTER_REGRESSION');
});

test('login: with username lists allowCredentials; unknown username gives the same shape', async () => {
  const ctx = await setup();
  const reg = await registerUser(ctx);
  const o = await ctx.svc.authenticationOptions({ flowId: 'L2', username: 'alice' });
  assert.deepEqual(o.allowCredentials.map(c => c.id), [reg.passkey.id]);
  const u = await ctx.svc.authenticationOptions({ flowId: 'L3', username: 'nobody' });
  assert.deepEqual(u.allowCredentials, []);
});

test('login: wrong origin and tampered signature are rejected', async () => {
  const ctx = await setup();
  await registerUser(ctx);
  const o = await ctx.svc.authenticationOptions({ flowId: 'L4' });
  await rejects(ctx.svc.verifyAuthentication({ flowId: 'L4', response: ctx.auth.authenticate(o, { originOverride: 'http://127.0.0.1:3007' }) }), 'ORIGIN_MISMATCH');
  const o2 = await ctx.svc.authenticationOptions({ flowId: 'L4' });
  const resp = ctx.auth.authenticate(o2);
  const sig = Buffer.from(resp.response.signature, 'base64url'); sig[sig.length - 1] ^= 0xff;
  resp.response.signature = sig.toString('base64url');
  await assert.rejects(ctx.svc.verifyAuthentication({ flowId: 'L4', response: resp }));
});

test('multiple passkeys: add, rename, delete guard, deleted credential cannot log in', async () => {
  const ctx = await setup();
  const reg = await registerUser(ctx);
  const user = reg.user;
  const phone = createSoftAuthenticator({ origin: ORIGIN, backupEligible: true });
  const o = await ctx.svc.registrationOptions({ flowId: 'A1', sessionUser: user });
  assert.deepEqual(o.excludeCredentials.map(c => c.id), [reg.passkey.id]);
  assert.throws(() => ctx.auth.register(o), { name: 'InvalidStateError' });
  const second = await ctx.svc.verifyRegistration({ flowId: 'A1', response: phone.register(o), name: 'Phone' });
  assert.equal(second.passkey.deviceType, 'multiDevice');
  assert.equal(second.passkey.backupEligible, true);
  assert.equal(second.passkey.backedUp, true);
  assert.equal((await ctx.svc.listPasskeys(user.id)).length, 2);
  await ctx.svc.renamePasskey(user.id, second.passkey.id, 'My phone');
  assert.equal((await ctx.store.getCredential(second.passkey.id)).name, 'My phone');
  await ctx.svc.deletePasskey(user.id, second.passkey.id);
  await rejects(ctx.svc.deletePasskey(user.id, reg.passkey.id), 'LAST_PASSKEY');
  const lo = await ctx.svc.authenticationOptions({ flowId: 'A2' });
  await rejects(ctx.svc.verifyAuthentication({ flowId: 'A2', response: phone.authenticate(lo) }), 'CREDENTIAL_NOT_FOUND');
});

test('debug decode: clientDataJSON, flags, COSE key', async () => {
  const ctx = await setup();
  const opts = await ctx.svc.registrationOptions({ flowId: 'D1', username: 'erin' });
  const d = safeDecode('registration', ctx.auth.register(opts));
  assert.equal(d.clientDataJSON.type, 'webauthn.create');
  assert.equal(d.attestation.fmt, 'none');
  assert.equal(d.authenticatorData.flags['UP (user present)'], true);
  assert.equal(d.authenticatorData.flags['UV (user verified)'], true);
  assert.equal(d.authenticatorData.flags['AT (attested credential data)'], true);
  assert.equal(d.coseKey['3 (alg)'], -7);
  assert.equal(ctx.svc.debugCeremonies()[0].kind, 'registration.options');
});

test('HTTP: cookies are HttpOnly/SameSite, foreign Origin rejected, debug API gated', async () => {
  for (const debug of [false, true]) {
    const store = await openStore(':memory:');
    const cfg = { ...baseCfg, debug, port: 0, host: '127.0.0.1', secureCookies: false };
    const app = await createApp({ cfg, store, log: silent });
    const port = await app.listen();
    const base = `http://127.0.0.1:${port}`;
    const post = (p, body, origin = ORIGIN) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    const r = await post('/api/register/options', { username: 'frank' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /pk_flow=.*HttpOnly; SameSite=Strict/);
    const bad = await post('/api/login/options', {}, 'https://evil.example');
    assert.equal(bad.status, 403);
    assert.equal((await bad.json()).error.code, 'ORIGIN_MISMATCH');
    const dbg = await fetch(base + '/api/debug/ceremonies');
    assert.equal(dbg.status, debug ? 200 : 404);
    const me = await fetch(base + '/api/passkeys');
    assert.equal(me.status, 401);
    assert.match((await fetch(base + '/')).headers.get('content-security-policy'), /script-src 'self'/);
    await app.close(); await store.close();
  }
});
