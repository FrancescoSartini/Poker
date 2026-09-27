/* Service worker: rende l'app installabile e veloce da riaprire.
   Prova sempre prima la rete (così gli aggiornamenti arrivano subito),
   e usa la copia salvata solo se la rete non risponde. */
const VERSION = 'pta-v1.2';
const SHELL = [
  './', './index.html', './app.js', './engine.js', './manifest.webmanifest',
  './tavolo-serif.woff', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
];
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (!sameOrigin && !req.url.startsWith(CDN)) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
