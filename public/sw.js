// ThreeWood service worker: makes the game playable in a tunnel.
// Pages are network-first (so a new deploy shows up), everything else is
// served from cache and refreshed in the background.
const CACHE = 'threewood-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  const put = (res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((r) => r || caches.match('/'))));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => {
    const fresh = fetch(req).then(put).catch(() => hit);
    return hit || fresh;
  }));
});
