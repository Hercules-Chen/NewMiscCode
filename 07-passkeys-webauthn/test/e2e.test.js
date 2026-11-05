// End-to-end: real server process + Chromium (Playwright) + CDP WebAuthn virtual authenticator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = join(ROOT, 'examples');
let playwright = null;
try { playwright = createRequire(import.meta.url)('playwright'); } catch { /* optional */ }

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer(port, dataDir) {
  const child = spawn(process.execPath, ['src/cli.js', '--port', String(port), '--data-dir', dataDir, '--debug'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return { child, log: () => out }; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill(); throw new Error('server did not start:\n' + out);
}

const AUTH_OPTS = { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

test('e2e: passkey register / login / usernameless / autofill / manage / failures', { skip: !playwright && 'playwright not installed (npm i -g playwright)', timeout: 120000 }, async () => {
  const port = await freePort();
  const ORIGIN = `http://localhost:${port}`;
  const dataDir = await mkdtemp(join(tmpdir(), 'pk-e2e-'));
  const srv = await startServer(port, dataDir);
  const browser = await playwright.chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1, locale: 'zh-TW' });
    const page = await ctx.newPage();
    let phase = 'happy';
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ phase, text: m.text() }); });
    page.on('pageerror', e => consoleErrors.push({ phase, text: 'pageerror: ' + e.message }));
    page.on('dialog', d => d.accept());

    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    let { authenticatorId: authA } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH_OPTS });

    const ready = async (url) => { await page.goto(url); await page.waitForSelector('body[data-ready="1"]'); };
    // Wait until #msg shows the given kind AND (optionally) text matching `re`.
    // Without `re`, a stale message from the previous step could be read before the new one renders.
    const msg = async (kind, re) => {
      await page.waitForFunction(([k, src, flags]) => {
        const m = document.querySelector('#msg');
        return !!m && !m.hidden && m.dataset.kind === k && (!src || new RegExp(src, flags).test(m.textContent));
      }, [kind, re ? re.source : null, re ? re.flags : '']);
      return page.textContent('#msg');
    };
    const passkeys = () => page.evaluate(() => fetch('/api/passkeys').then(r => r.json()));
    const logout = async () => { await page.click('#logoutBtn'); await page.waitForURL(u => new URL(u).pathname === '/'); };

    // 1. default language zh-TW, toggle to en and back
    await ready(`${ORIGIN}/?autofill=0`);
    assert.equal(await page.textContent('#loginForm h2'), '使用 Passkey 登入');
    await page.click('#langBtn');
    assert.equal(await page.textContent('#loginForm h2'), 'Sign in with a passkey');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    await page.click('#langBtn');
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hant');

    // 2. register
    await page.fill('#regUser', 'alice');
    await page.fill('#regName', 'Alice Chen');
    await page.click('#registerBtn');
    await page.waitForURL('**/account*');
    assert.match(await msg('ok', /註冊成功/), /註冊成功/);
    let pk = await passkeys();
    assert.equal(pk.passkeys.length, 1);
    const firstId = pk.passkeys[0].id;
    let counter = pk.passkeys[0].counter;
    assert.equal(pk.passkeys[0].aaguid, '01020304-0506-0708-0102-030405060708');

    // 3. logout, login with username
    await logout();
    await ready(`${ORIGIN}/?autofill=0`);
    await page.fill('#loginUser', 'alice');
    await page.click('#loginBtn');
    await page.waitForURL('**/account*');
    pk = await passkeys();
    assert.ok(pk.passkeys[0].counter > counter, 'counter increments after login'); counter = pk.passkeys[0].counter;

    // 4. usernameless (discoverable credential)
    await logout();
    await ready(`${ORIGIN}/?autofill=0`);
    await page.click('#loginBtn');
    await page.waitForURL('**/account*');
    pk = await passkeys();
    assert.ok(pk.passkeys[0].counter > counter); counter = pk.passkeys[0].counter;

    // 5. conditional UI (autofill): the virtual authenticator answers the conditional get() automatically
    await logout();
    await ready(`${ORIGIN}/`);
    await page.waitForURL('**/account*');
    pk = await passkeys();
    assert.ok(pk.passkeys[0].counter > counter); counter = pk.passkeys[0].counter;
    await page.waitForSelector('#auditTable tbody tr');
    await page.screenshot({ path: join(EXAMPLES, 'account-zh.png') });

    // 6. same authenticator again -> excludeCredentials -> InvalidStateError
    phase = 'expected-failure';
    await page.click('#addPkBtn');
    assert.match(await msg('error', /InvalidStateError/), /InvalidStateError/);

    // 7. second passkey on another authenticator
    phase = 'happy';
    const exported = (await cdp.send('WebAuthn.getCredentials', { authenticatorId: authA })).credentials;
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authA });
    const { authenticatorId: authB } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH_OPTS });
    await page.fill('#newPkName', 'Phone B');
    await page.click('#addPkBtn');
    assert.match(await msg('ok', /Phone B/), /Phone B/);
    pk = await passkeys();
    assert.equal(pk.passkeys.length, 2);
    const secondId = pk.passkeys.find(p => p.name === 'Phone B').id;

    // 8. delete passkey B; deleting the last one is refused
    await page.click(`li[data-id="${secondId}"] button.danger`);
    assert.match(await msg('ok', /已刪除/), /已刪除/);
    assert.equal((await passkeys()).passkeys.length, 1);
    phase = 'expected-failure';
    await page.click(`li[data-id="${firstId}"] button.danger`);
    assert.match(await msg('error', /唯一的 passkey/), /唯一的 passkey/);

    // 9. authenticator B still holds the deleted credential -> CREDENTIAL_NOT_FOUND
    phase = 'happy';
    await logout();
    phase = 'expected-failure';
    await ready(`${ORIGIN}/?autofill=0`);
    await page.click('#loginBtn');
    assert.match(await msg('error', /找不到這個 passkey/), /找不到這個 passkey/);
    assert.equal(new URL(page.url()).pathname, '/');

    // 10. restore authenticator A (exported key + counter) and log in again
    phase = 'happy';
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authB });
    ({ authenticatorId: authA } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH_OPTS }));
    for (const c of exported) await cdp.send('WebAuthn.addCredential', { authenticatorId: authA, credential: c });
    await ready(`${ORIGIN}/?autofill=0`);
    await page.click('#loginBtn');
    await page.waitForURL('**/account*');
    pk = await passkeys();
    assert.ok(pk.passkeys[0].counter > counter, 'counter keeps increasing'); counter = pk.passkeys[0].counter;
    const audit = await page.evaluate(() => fetch('/api/audit').then(r => r.json()));
    assert.ok(audit.events.some(e => e.event === 'login' && !e.ok && /CREDENTIAL_NOT_FOUND/.test(e.detail)), 'failed login audited');
    assert.ok(audit.events.some(e => e.event === 'passkey.delete' && e.ok));

    // 11. counter regression: replay an old signCount -> rejected
    phase = 'expected-failure';
    await logout();
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authA });
    ({ authenticatorId: authA } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH_OPTS }));
    for (const c of exported) await cdp.send('WebAuthn.addCredential', { authenticatorId: authA, credential: { ...c, signCount: 0 } });
    await ready(`${ORIGIN}/?autofill=0`);
    await page.click('#loginBtn');
    assert.match(await msg('error', /簽章計數器/), /簽章計數器/);

    // 12. origin mismatch: same server opened via 127.0.0.1 (not the configured origin)
    await ready(`http://127.0.0.1:${port}/?autofill=0`);
    assert.match(await page.textContent('#envWarn'), /localhost/);
    await page.click('#loginBtn');
    assert.match(await msg('error', /origin/i), /origin/i);

    // 13. debug page (en, dark) shows decoded flags
    phase = 'happy';
    for (const c of exported) await cdp.send('WebAuthn.removeCredential', { authenticatorId: authA, credentialId: c.credentialId }).catch(() => {});
    for (const c of exported) await cdp.send('WebAuthn.addCredential', { authenticatorId: authA, credential: { ...c, signCount: counter + 10 } });
    await ready(`${ORIGIN}/?autofill=0`);
    await page.click('#loginBtn');
    await page.waitForURL('**/account*');
    await page.click('#langBtn');
    await page.click('#themeBtn');
    await page.click('a[data-view="debug"]');
    await page.waitForSelector('#debugList details');
    const dbg = await page.textContent('#debugList');
    assert.match(dbg, /UP \(user present\)/);
    assert.match(dbg, /BE \(backup eligible\)/);
    assert.match(dbg, /webauthn\.get/);
    await page.screenshot({ path: join(EXAMPLES, 'debug-en-dark.png') });

    // 14. mobile width: no horizontal scroll
    await page.click('#themeBtn');
    await page.click('#langBtn');
    await page.setViewportSize({ width: 390, height: 760 });
    await page.click('a[data-view="account"]');
    await page.waitForSelector('.pk');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'account page fits 390px');
    await logout();
    await ready(`${ORIGIN}/?autofill=0`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'login page fits 390px');
    await page.screenshot({ path: join(EXAMPLES, 'login-mobile-390.png') });

    // console errors: none in happy phases; in failure phases only the expected HTTP 4xx resource errors
    const unexpected = consoleErrors.filter(e => e.phase === 'happy' || !/Failed to load resource: the server responded with a status of 4\d\d/.test(e.text));
    assert.deepEqual(unexpected, [], 'no unexpected console errors');
  } catch (err) {
    console.error(srv.log().split('\n').filter(l => !l.startsWith('[debug] http')).slice(-30).join('\n'));
    throw err;
  } finally {
    await browser.close();
    srv.child.kill();
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
});

await mkdir(EXAMPLES, { recursive: true });
