// Passkey (WebAuthn) service: ceremony options, verification, passkey management.
// Transport-agnostic (no HTTP here) so it can be unit tested directly.
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  isoBase64URL, parseAuthenticatorData, decodeClientDataJSON,
  decodeAttestationObject, decodeCredentialPublicKey,
} from '@simplewebauthn/server/helpers';
import { randomBytes, createHash } from 'node:crypto';
import { describeAaguid } from './aaguid.js';
import { short } from './logger.js';

export class AppError extends Error {
  constructor(code, status = 400, message = code, extra = {}) { super(message); this.code = code; this.status = status; this.extra = extra; }
}

const USERNAME_RE = /^[A-Za-z0-9._@-]{3,32}$/;
export const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

export function createPasskeyService({ store, cfg, log }) {
  const debugRing = []; // last ceremonies, only kept when cfg.debug
  const remember = entry => {
    if (!cfg.debug) return;
    debugRing.unshift({ at: new Date().toISOString(), ...entry });
    debugRing.length = Math.min(debugRing.length, 20);
  };

  const expectedOrigin = cfg.origins.length === 1 ? cfg.origins[0] : cfg.origins;

  function publicPasskey(c) {
    return {
      id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, counter: c.counter,
      transports: c.transports, aaguid: c.aaguid, authenticator: describeAaguid(c.aaguid), fmt: c.fmt,
      deviceType: c.deviceType, backupEligible: c.backupEligible, backedUp: c.backedUp, uvInitialized: c.uvInitialized,
      publicKeyFingerprint: fingerprint(c.publicKey),
    };
  }

  async function registrationOptions({ flowId, sessionUser, username, displayName }) {
    let user = sessionUser, pending = null, exclude = [];
    if (user) {
      exclude = (await store.listCredentials(user.id)).map(c => ({ id: c.id, transports: c.transports }));
    } else {
      username = String(username || '').trim();
      displayName = String(displayName || '').trim().slice(0, 64) || username;
      if (!USERNAME_RE.test(username)) throw new AppError('USERNAME_INVALID', 400, 'Username must be 3-32 chars: letters, digits, . _ @ -');
      if (await store.getUserByName(username)) throw new AppError('USERNAME_TAKEN', 409, 'Username already registered; sign in with your passkey instead');
      pending = { username, displayName, webauthnUserId: isoBase64URL.fromBuffer(randomBytes(32)) };
    }
    const handle = user ? user.webauthnUserId : pending.webauthnUserId;
    const options = await generateRegistrationOptions({
      rpName: cfg.rpName,
      rpID: cfg.rpID,
      userName: user ? user.username : pending.username,
      userDisplayName: user ? user.displayName : pending.displayName,
      userID: isoBase64URL.toBuffer(handle),
      attestationType: 'none',
      excludeCredentials: exclude,
      timeout: 60000,
      authenticatorSelection: {
        residentKey: 'required',          // discoverable credential = "passkey" (enables usernameless login)
        requireResidentKey: true,
        userVerification: cfg.requireUV ? 'required' : 'preferred',
      },
      supportedAlgorithmIDs: [-7, -257],  // ES256, RS256 (Windows Hello may use RS256)
    });
    await store.putChallenge(flowId, 'register', options.challenge, { userId: user?.id ?? null, pending, ttlMs: cfg.challengeTtlMs });
    log.debug('register.options', { user: user?.username ?? pending.username, exclude: exclude.length });
    remember({ kind: 'registration.options', options });
    return options;
  }

  async function verifyRegistration({ flowId, response, name }) {
    const ch = await store.takeChallenge(flowId, 'register');
    if (!ch) throw new AppError('CHALLENGE_MISSING', 400, 'No pending registration; request new options');
    if (ch.expired) throw new AppError('CHALLENGE_EXPIRED', 400, 'Registration challenge expired; try again');
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: cfg.rpID,
        requireUserVerification: cfg.requireUV,
      });
    } catch (err) {
      remember({ kind: 'registration.response', ok: false, error: err.message, response, decoded: safeDecode('registration', response) });
      throw classifyVerifyError(err);
    }
    if (!verification.verified) throw new AppError('VERIFY_FAILED', 400, 'Registration could not be verified');
    const info = verification.registrationInfo;
    if (await store.getCredential(info.credential.id)) throw new AppError('CREDENTIAL_EXISTS', 409, 'This passkey is already registered');
    const authData = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get('authData');
    const flags = parseAuthenticatorData(authData).flags;
    const cred = {
      id: info.credential.id, publicKey: info.credential.publicKey, counter: info.credential.counter,
      transports: info.credential.transports ?? response.response.transports ?? [], aaguid: info.aaguid, fmt: info.fmt,
      deviceType: info.credentialDeviceType, backupEligible: flags.be, backedUp: info.credentialBackedUp, uvInitialized: info.userVerified,
      name: String(name || '').trim().slice(0, 60) || `${describeAaguid(info.aaguid)} ${new Date().toISOString().slice(0, 10)}`,
    };
    let user;
    if (ch.userId) {
      user = await store.getUserById(ch.userId);
      if (!user) throw new AppError('USER_NOT_FOUND', 404, 'User no longer exists');
      await store.addCredential({ ...cred, userId: user.id });
    } else {
      const p = ch.pending;
      if (await store.getUserByName(p.username)) throw new AppError('USERNAME_TAKEN', 409, 'Username already registered');
      const id = await store.createUserWithCredential(p, cred);
      user = await store.getUserById(id);
    }
    log.info('register.ok', { user: user.username, cred: short(cred.id), aaguid: cred.aaguid, be: cred.backupEligible, bs: cred.backedUp });
    log.debug('register.publicKey', { cred: short(cred.id), pkFingerprint: fingerprint(cred.publicKey) });
    remember({ kind: 'registration.response', ok: true, response, decoded: safeDecode('registration', response) });
    return { user, passkey: publicPasskey(await store.getCredential(cred.id)) };
  }

  async function authenticationOptions({ flowId, username }) {
    let allow = [], userId = null;
    if (username) {
      const user = await store.getUserByName(String(username).trim());
      // Unknown usernames get the same shape of response (no allowCredentials) to limit account enumeration.
      if (user) {
        userId = user.id;
        allow = (await store.listCredentials(user.id)).map(c => ({ id: c.id, transports: c.transports }));
      }
    }
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpID, allowCredentials: allow, timeout: 60000,
      userVerification: cfg.requireUV ? 'required' : 'preferred',
    });
    await store.putChallenge(flowId, 'login', options.challenge, { userId, ttlMs: cfg.challengeTtlMs });
    log.debug('login.options', { username: username || null, allow: allow.length });
    remember({ kind: 'authentication.options', options });
    return options;
  }

  async function verifyAuthentication({ flowId, response }) {
    const ch = await store.takeChallenge(flowId, 'login');
    if (!ch) throw new AppError('CHALLENGE_MISSING', 400, 'No pending login; request new options');
    if (ch.expired) throw new AppError('CHALLENGE_EXPIRED', 400, 'Login challenge expired; try again');
    const credId = response?.id;
    const cred = credId ? await store.getCredential(credId) : null;
    if (!cred) {
      // Attribute the failed attempt via userHandle (discoverable credentials carry it) for the audit log.
      const owner = response?.response?.userHandle ? await store.getUserByHandle(response.response.userHandle) : null;
      remember({ kind: 'authentication.response', ok: false, error: 'credential not found', response, decoded: safeDecode('authentication', response) });
      throw new AppError('CREDENTIAL_NOT_FOUND', 404, 'This passkey is not registered here (it may have been deleted). Remove it from your device or register again.', { credentialId: credId, user: owner || undefined });
    }
    const user = await store.getUserById(cred.userId);
    if (ch.userId && ch.userId !== user.id) throw new AppError('USER_MISMATCH', 400, 'Passkey belongs to a different account');
    const userHandle = response.response?.userHandle;
    if (userHandle && userHandle !== user.webauthnUserId) throw new AppError('USER_MISMATCH', 400, 'userHandle does not match the credential owner');

    // Signature counter check (done explicitly so the error is clear and audited).
    const parsed = parseAuthenticatorData(isoBase64URL.toBuffer(response.response.authenticatorData));
    if ((parsed.counter > 0 || cred.counter > 0) && parsed.counter <= cred.counter) {
      throw new AppError('COUNTER_REGRESSION', 400, `Signature counter did not increase (stored ${cred.counter}, got ${parsed.counter}); possible cloned authenticator`, { user, credentialId: cred.id });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: cfg.rpID,
        credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports },
        requireUserVerification: cfg.requireUV,
      });
    } catch (err) {
      remember({ kind: 'authentication.response', ok: false, error: err.message, response, decoded: safeDecode('authentication', response) });
      throw classifyVerifyError(err, { user, credentialId: cred.id });
    }
    if (!verification.verified) throw new AppError('VERIFY_FAILED', 400, 'Signature verification failed', { user, credentialId: cred.id });
    const ai = verification.authenticationInfo;
    await store.updateCredentialUse(cred.id, ai.newCounter, ai.credentialBackedUp);
    log.info('login.ok', { user: user.username, cred: short(cred.id), counter: ai.newCounter, uv: ai.userVerified });
    remember({ kind: 'authentication.response', ok: true, response, decoded: safeDecode('authentication', response) });
    return { user, passkey: publicPasskey(await store.getCredential(cred.id)), counter: ai.newCounter, userVerified: ai.userVerified };
  }

  async function listPasskeys(userId) { return (await store.listCredentials(userId)).map(publicPasskey); }
  async function renamePasskey(userId, id, name) {
    name = String(name || '').trim().slice(0, 60);
    if (!name) throw new AppError('NAME_REQUIRED', 400, 'Name is required');
    if (!(await store.renameCredential(userId, id, name))) throw new AppError('NOT_FOUND', 404, 'Passkey not found');
    return name;
  }
  async function deletePasskey(userId, id) {
    const list = await store.listCredentials(userId);
    if (!list.some(c => c.id === id)) throw new AppError('NOT_FOUND', 404, 'Passkey not found');
    if (list.length <= 1) throw new AppError('LAST_PASSKEY', 400, 'Cannot delete your only passkey (you would be locked out)');
    await store.deleteCredential(userId, id);
  }

  return {
    registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication,
    listPasskeys, renamePasskey, deletePasskey, debugCeremonies: () => debugRing,
  };
}

function classifyVerifyError(err, extra = {}) {
  const m = err.message || '';
  if (/origin/i.test(m)) return new AppError('ORIGIN_MISMATCH', 400, m, extra);
  if (/rp ?id/i.test(m)) return new AppError('RPID_MISMATCH', 400, m, extra);
  if (/challenge/i.test(m)) return new AppError('CHALLENGE_MISMATCH', 400, m, extra);
  if (/user verification|user could not be verified/i.test(m)) return new AppError('UV_REQUIRED', 400, m, extra);
  if (/counter/i.test(m)) return new AppError('COUNTER_REGRESSION', 400, m, extra);
  return new AppError('VERIFY_FAILED', 400, m, extra);
}

const FLAG_NAMES = { up: 'UP (user present)', uv: 'UV (user verified)', be: 'BE (backup eligible)', bs: 'BS (backed up / synced)', at: 'AT (attested credential data)', ed: 'ED (extension data)' };
const COSE_LABELS = { 1: 'kty', 3: 'alg', '-1': 'crv|n', '-2': 'x|e', '-3': 'y' };
const hex = b => Buffer.from(b).toString('hex');

/** Decode a WebAuthn response for the learning/debug page. Public data only (no secrets exist client-side). */
export function safeDecode(kind, response) {
  try {
    const out = { clientDataJSON: decodeClientDataJSON(response.response.clientDataJSON) };
    let authData;
    if (kind === 'registration') {
      const att = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
      out.attestation = { fmt: att.get('fmt'), attStmtKeys: [...(att.get('attStmt')?.keys?.() ?? [])] };
      authData = att.get('authData');
    } else {
      authData = isoBase64URL.toBuffer(response.response.authenticatorData);
    }
    const p = parseAuthenticatorData(authData);
    out.authenticatorData = {
      rpIdHash: hex(p.rpIdHash), flagsByte: '0x' + p.flags.flagsInt.toString(16).padStart(2, '0'),
      flags: Object.fromEntries(Object.entries(FLAG_NAMES).map(([k, label]) => [label, p.flags[k]])),
      signCount: p.counter,
    };
    if (p.aaguid) out.authenticatorData.aaguid = [...hex(p.aaguid)].join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    if (p.credentialID) out.authenticatorData.credentialID = isoBase64URL.fromBuffer(p.credentialID);
    if (p.credentialPublicKey) {
      const cose = decodeCredentialPublicKey(p.credentialPublicKey);
      out.coseKey = Object.fromEntries([...cose.entries()].map(([k, v]) => [`${k} (${COSE_LABELS[k] ?? '?'})`, v instanceof Uint8Array ? hex(v) : v]));
      out.coseKeyNote = 'kty 2 = EC2, 3 = RSA; alg -7 = ES256, -257 = RS256; crv 1 = P-256';
    }
    if (response.response.userHandle) out.userHandle = response.response.userHandle;
    return out;
  } catch (err) {
    return { decodeError: err.message };
  }
}
