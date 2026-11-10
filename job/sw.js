/* Mechanix Pro job screen: a pass-through worker so the phone offers Install. It caches nothing, because the job link is private. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request)); });
