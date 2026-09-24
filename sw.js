// App-shell cache only. Never intercepts PocketBase API/dashboard calls or the CDN —
// data freshness is handled by js/db.js's own version check, not by this
// worker. Bump CACHE_NAME whenever you deploy a change so clients pick it
// up instead of serving a stale shell.
const CACHE_NAME = 'ecovite-shell-v73';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/rep.js',
  './js/admin.js',
  './js/history.js',
  './js/mixRender.js',
  './js/report.js',
  './js/users.js',
  './js/db.js',
  './js/pocketbaseBackend.js',
  './js/pocketbaseMappers.js',
  './js/vendor/pocketbase.es.mjs',
  './js/calc.js',
  './js/config.js',
  './js/seedData.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let CDN requests pass straight through
  // PocketBase is on the same origin: its API and dashboard must always hit the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => cached)
    )
  );
});
