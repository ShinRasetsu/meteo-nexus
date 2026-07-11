const APP_CACHE = 'meteonexus-app-v5';
const API_CACHE = 'meteonexus-api-cache';
const MAP_CACHE = 'meteonexus-map-cache';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './worker.js',
    './sw.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(APP_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(k => {
                if (![APP_CACHE, API_CACHE, MAP_CACHE].includes(k)) return caches.delete(k);
            })
        ))
    );
    self.clients.claim();
});

self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // MAP TILE CACHE: Cache First, Network Fallback
    if (url.hostname.includes('tile.openstreetmap.org')) {
        e.respondWith(
            caches.match(e.request).then(res => {
                return res || fetch(e.request).then(netRes => {
                    if (netRes.ok) {
                        const cloned = netRes.clone();
                        // Non-blocking caching preserves render thread performance 
                        caches.open(MAP_CACHE).then(cache => cache.put(e.request, cloned));
                    }
                    return netRes;
                });
            }).catch(() => new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#111"/><text x="128" y="128" fill="#333" font-family="monospace" font-size="14" text-anchor="middle">OFFLINE</text></svg>', 
                { headers: { 'Content-Type': 'image/svg+xml' } }
            ))
        );
        return;
    }

    // API REQUESTS: Network First, Persistent Cache Fallback
    if (url.hostname.includes('api.open-meteo.com') || url.hostname.includes('overpass-api.de') || url.hostname.includes('valhalla')) {
        e.respondWith(
            new Promise((resolve) => {
                let isResolved = false;
                const timeoutId = setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        caches.match(e.request).then(res => resolve(res || new Response('{"error":"timeout"}', { status: 504 })));
                    }
                }, 8000);

                fetch(e.request).then(netRes => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);
                        // Hard failure redirection to cache for 4xx/5xx responses
                        if (netRes.ok) {
                            const cloned = netRes.clone();
                            caches.open(API_CACHE).then(cache => {
                                cache.put(e.request, cloned);
                                // LRU eviction: keep max 200 entries
                                cache.keys().then(keys => {
                                    if (keys.length > 200) cache.delete(keys[0]);
                                });
                            });
                            resolve(netRes);
                        } else {
                            caches.match(e.request).then(res => resolve(res || netRes));
                        }
                    }
                }).catch(() => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);
                        caches.match(e.request).then(res => resolve(res || new Response('{"error":"offline"}', { status: 503 })));
                    }
                });
            })
        );
    } 
    // ALL OTHER REQUESTS: Network First, App Cache Fallback
    else {
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    // Serve cached asset if network throws error
                    if (!response || (response.status !== 200 && response.status !== 0)) {
                        return caches.match(e.request).then(cached => cached || response);
                    }
                    if (!e.request.url.startsWith('http')) return response;

                    const responseToCache = response.clone();
                    caches.open(APP_CACHE).then(cache => {
                        cache.put(e.request, responseToCache);
                    });
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
    }
});