// mySpark service worker: makes the app installable and usable offline.
// Network first, so a rebuilt app shows up on the next load; the cache is the offline fallback.
const CACHE = 'myspark-v7';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app/main.js',
  './js/app/model.js',
  './js/app/browser-ai.js',
  './js/app/tone-ai.js',
  './js/app/tone-db.js',
  './js/app/dev-reload.js',
  './js/app/tonecloud.js',
  './js/app/theme.js',
  './js/app/tone-sync.js',
  './js/app/native-ble.js',
  './js/spark/protocol.js',
  './js/spark/transport.js',
  './js/spark/verify.js',
  './js/spark/catalog.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Leave cross-origin requests and the dev server's live-reload stream alone.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/__dev/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline')))),
  );
});
