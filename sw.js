/* Kalo — service worker: la app funciona sin conexión; las consultas a USDA / Open Food Facts van siempre a la red. */
const VERSION = "kalo-1790987291";
const SHELL = ["./", "./index.html", "./kalo-foods-data.js", "./kalo-db.js", "./kalo-i18n-en.js", "./kalo-i18n.js", "./kalo-online.js", "./kalo-account.js", "./kalo-telemetry.js", "./kalo-deficit.js", "./kalo-security.js", "./zxing.min.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;            // APIs externas: red directa
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
