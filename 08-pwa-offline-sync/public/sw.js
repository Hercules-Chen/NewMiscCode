/* Hand-written Service Worker.
 * - Precache app shell into a versioned cache (shell-<BUILD_ID>), cleanup old caches on activate.
 * - Navigations (HTML): network-first with timeout, fallback to cached shell.
 * - Static assets: cache-first (precache), fallback network.
 * - API GET: stale-while-revalidate (cache api-v1); notifies pages when fresh data differs.
 * - Non-GET: passthrough (writes go through the IndexedDB outbox, never cached).
 * - Background Sync tag "outbox-sync": replays the outbox (shared code in /js/outbox-core.js).
 * - Update flow: new worker waits; page shows banner; page posts {type:'SKIP_WAITING'}.
 */
'use strict';
const BUILD_ID = '__BUILD_ID__'; // injected by the server (package version + hash of shell files)
const SHELL_CACHE = 'shell-' + BUILD_ID;
const API_CACHE = 'api-v1';
const KEEP = [SHELL_CACHE, API_CACHE];
const NAV_TIMEOUT_MS = 3000;
const SHELL = [
  '/', '/index.html', '/css/app.css', '/js/app.js', '/js/i18n.js', '/js/outbox-core.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
];

importScripts('/js/outbox-core.js');
const core = self.OutboxCore;
let debug = false;

function dbg(msg, data) {
  if (debug) console.debug('[sw ' + BUILD_ID + ']', msg, data || '');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache: 'reload' bypasses the HTTP cache so the precache really matches this build
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    dbg('installed', { cache: SHELL_CACHE });
    // NOTE: no automatic skipWaiting(); the page asks the user first (update banner).
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const removed = names.filter((n) => !KEEP.includes(n));
    await Promise.all(removed.map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* */ } }
    await self.clients.claim();
    core.addLog('info', 'sw-activated', { buildId: BUILD_ID, removedCaches: removed }, 'sw');
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') { dbg('skipWaiting requested'); self.skipWaiting(); }
  else if (msg.type === 'GET_VERSION') { event.source && event.source.postMessage({ type: 'VERSION', buildId: BUILD_ID, shellCache: SHELL_CACHE }); }
  else if (msg.type === 'SET_DEBUG') { debug = !!msg.value; }
  else if (msg.type === 'REPLAY') {
    // Pages delegate replay to the SW so there is a single sync engine (also used by Background Sync).
    const port = event.ports && event.ports[0];
    event.waitUntil(core.replay({ source: 'sw:' + (msg.reason || 'message') }).then(
      (res) => { if (port) port.postMessage({ ok: true, res }); },
      (err) => { if (port) port.postMessage({ ok: false, error: String(err) }); },
    ));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'outbox-sync') return;
  dbg('background sync fired', { lastChance: event.lastChance });
  event.waitUntil(core.replay({ source: 'sw-bgsync' }).then((res) => {
    // Reject so the browser retries later (with backoff) if the network is still failing.
    if (res.networkError && res.remaining > 0) throw new Error('replay incomplete: ' + res.networkError);
  }));
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)); }

async function networkFirstHtml(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const res = preload || await Promise.race([fetch(event.request), timeout(NAV_TIMEOUT_MS)]);
    if (res && res.ok && new URL(event.request.url).pathname === '/') cache.put('/', res.clone());
    return res;
  } catch (e) {
    dbg('navigation offline -> cached shell', { url: event.request.url });
    return (await cache.match(event.request, { ignoreSearch: true })) || (await cache.match('/index.html')) || (await cache.match('/'))
      || new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') (await caches.open(SHELL_CACHE)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(API_CACHE);
  const req = event.request;
  const cached = await cache.match(req);
  const network = fetch(req).then(async (res) => {
    if (res.ok) {
      const fresh = res.clone();
      const text = await res.clone().text();
      const oldText = cached ? await cached.clone().text() : null;
      await cache.put(req, fresh);
      if (cached && text !== oldText) {
        // tell pages the cached copy they got was stale
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => c.postMessage({ type: 'API_UPDATED', url: req.url, body: text }));
      }
    }
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    const h = new Headers(cached.headers);
    h.set('X-SW-Cache', 'stale');
    return new Response(await cached.blob(), { status: cached.status, headers: h });
  }
  try { return await network; } catch (e) {
    return new Response(JSON.stringify({ error: 'offline', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-SW-Cache': 'miss' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes: passthrough
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/health') return; // always live
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  if (req.mode === 'navigate') { event.respondWith(networkFirstHtml(event)); return; }
  event.respondWith(cacheFirst(req));
});
