// Service worker: network-first for the app shell, cache fallback when offline / server down.
// Documents themselves live in IndexedDB (y-indexeddb), not here.
const CACHE = 'crdt-collab-shell-v1';
const SHELL = ['./', 'index.html', 'app.css', 'dist/app.js', 'favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true });
      if (cached) return cached;
      throw err;
    }
  })());
});
