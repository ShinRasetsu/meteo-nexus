const APP_CACHE = 'meteonexus-app-v5';
const API_CACHE = 'meteonexus-api-cache';
const MAP_CACHE = 'meteonexus-map-cache';
const MAX_TILE_CACHE_ITEMS = 500; // Strict storage boundary (~15MB max footprint)

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './worker.js',
    './sw.js',
    './UI_RadarCard.js',
    './UI_WeatherChart.js',
    './UI_FuelModal.js'
];

/**
 * Bounds the cache size to prevent OS-level storage exhaustion
 */
async function trimCache(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        if (keys.length > maxItems) {
            for (let i = 0; i < keys.length - maxItems; i++) {
                await cache.delete(keys[i]);
            }
        }
    } catch (e) {
        console.warn("SW Cache Trim Failed:", e);
    }
}

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

    // MAP TILE CACHE: Cache First, Network Fallback with Strict FIFO Trimming
    if (url.hostname.includes('tile.openstreetmap.org')) {
        e.respondWith(
            caches.match(e.request).then(res => {
                return res || fetch(e.request).then(netRes => {
                    if (netRes.ok) {
                        caches.open(MAP_CACHE).then(cache => {
                            cache.put(e.request, netRes.clone());
                            trimCache(MAP_CACHE, MAX_TILE_CACHE_ITEMS);
                        });
                    }
                    return netRes;
                });
            })
        );
    } 
    // API CACHE: Network First, Strict Cache Fallback
    else if (url.hostname.includes('api.open-meteo.com') || url.hostname.includes('overpass-api.de')) {
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
                        if (netRes.ok) {
                            caches.open(API_CACHE).then(cache => {
                                cache.put(e.request, netRes.clone());
                                trimCache(API_CACHE, 50); // Keep API payloads bounded
                            });
                        }
                        resolve(netRes);
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
                    if (!response || (response.status !== 200 && response.status !== 0)) return response;
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