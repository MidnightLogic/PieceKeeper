const CACHE_NAME = 'piecekeeper-cache-v1775733358673';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './manifest-icon-192.maskable.png',
  './manifest-icon-512.maskable.png',
  './apple-icon-180.png'
];

self.addEventListener('install', event => {
    // Pre-cache all critical assets immediately upon installation
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Delete all previous caches that do not match the current version
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            ).then(() => self.clients.claim());
        })
    );
});

// Network First, Cache Fallback strategy
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // If network fetch is successful and is a 200 OK, update cache and return it
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic' && event.request.method === 'GET' && event.request.url.startsWith('http')) {
                    let responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                    return networkResponse;
                }
                
                // If the server returns a 503 (like LocalTunnel does when closed) or 404, fallback to cache!
                if (!networkResponse || networkResponse.status !== 200) {
                     return caches.match(event.request).then(cached => cached || networkResponse);
                }

                return networkResponse;
            })
            .catch(() => {
                // Hard network failure (e.g., Wi-Fi turned off), fallback to cache
                return caches.match(event.request);
            })
    );
});
