// Minimal software authenticator for unit tests: builds real WebAuthn responses (attestation "none",
// ES256) so the server code is exercised end-to-end without a browser.
import { generateKeyPairSync, createHash, sign, randomBytes } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

const b64u = buf => isoBase64URL.fromBuffer(new Uint8Array(buf));
const sha256 = data => createHash('sha256').update(data).digest();
const AAGUID = Buffer.from('7e570000000000000000000000000001', 'hex');

export function createSoftAuthenticator({ rpId = 'localhost', origin = 'http://localhost:3007', backupEligible = false } = {}) {
  const creds = new Map(); // id -> { privateKey, cose, counter, userHandle }

  function authData({ counter, flags, attested }) {
    const head = Buffer.concat([sha256(rpId), Buffer.from([flags]), Buffer.alloc(4)]);
    head.writeUInt32BE(counter, 33);
    if (!attested) return head;
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(attested.id.length);
    return Buffer.concat([head, AAGUID, idLen, attested.id, Buffer.from(attested.cose)]);
  }
  const flagsByte = uv => 0x01 | (uv ? 0x04 : 0) | (backupEligible ? 0x18 : 0);

  return {
    creds,
    /** navigator.credentials.create() equivalent; returns RegistrationResponseJSON */
    register(options, { originOverride, uv = true } = {}) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, isoBase64URL.toBuffer(jwk.x)], [-3, isoBase64URL.toBuffer(jwk.y)]]));
      const id = randomBytes(16);
      for (const ex of options.excludeCredentials || []) {
        if (creds.has(ex.id)) { const e = new Error('excluded'); e.name = 'InvalidStateError'; throw e; }
      }
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: originOverride || origin, crossOrigin: false }));
      const ad = authData({ counter: 0, flags: flagsByte(uv) | 0x40, attested: { id, cose } });
      const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(ad)]]));
      const credId = b64u(id);
      creds.set(credId, { privateKey, counter: 0, userHandle: options.user.id });
      return {
        id: credId, rawId: credId, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
      };
    },
    /** navigator.credentials.get() equivalent; picks the first allowed (or any resident) credential */
    authenticate(options, { credId, originOverride, counter, uv = true } = {}) {
      const allowed = (options.allowCredentials || []).map(c => c.id);
      const id = credId || allowed.find(a => creds.has(a)) || [...creds.keys()][0];
      const c = creds.get(id);
      if (!c) { const e = new Error('no credential'); e.name = 'NotAllowedError'; throw e; }
      c.counter = counter ?? c.counter + 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: originOverride || origin, crossOrigin: false }));
      const ad = authData({ counter: c.counter, flags: flagsByte(uv) });
      const signature = sign('sha256', Buffer.concat([ad, sha256(clientDataJSON)]), c.privateKey);
      return {
        id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(ad), signature: b64u(signature), userHandle: c.userHandle },
      };
    },
  };
}
