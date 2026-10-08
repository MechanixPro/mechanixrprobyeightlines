/* Mechanix Pro service worker: fast repeat visits + offline page. Never caches admin or API calls. */
const VERSION = 'mxp-v3';
const CORE = ['/', '/assets/css/style.css', '/assets/js/app.js', '/assets/js/logic.js', '/assets/js/loader.js', '/assets/js/bikes.js', '/book/', '/services/', '/help/', '/assets/js/config.js', '/assets/img/logo.svg', '/assets/img/logo-mark.webp', '/assets/img/logo-wordmark.webp', '/assets/img/icon-192.png', '/offline.html'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/admin')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then((r) => r || caches.match('/offline.html'))));
    return;
  }
  // Code and brand files: always try the network first so a new logo or style shows up straight away; the cache is only the offline fallback.
  if (/\.(css|js)$/.test(url.pathname) || /\/assets\/img\/(logo|icon|favicon|og|apple)/.test(url.pathname)) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
