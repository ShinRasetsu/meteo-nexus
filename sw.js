const APP_CACHE = 'meteonexus-app-v4';
const MAP_CACHE = 'meteonexus-map-cache';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(APP_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(k => {
                if (k !== APP_CACHE && k !== MAP_CACHE) return caches.delete(k);
            })
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // MAP TILE CACHE: Cache First, Network Fallback
    if (url.hostname.includes('tile.openstreetmap.org')) {
        e.respondWith(
            caches.match(e.request).then(res => {
                return res || fetch(e.request).then(netRes => {
                    return caches.open(MAP_CACHE).then(cache => {
                        if (netRes.ok) cache.put(e.request, netRes.clone());
                        return netRes;
                    });
                });
            }).catch(() => new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#111"/></svg>', 
                { headers: { 'Content-Type': 'image/svg+xml' } }
            ))
        );
    } 
    // METEO API CACHE: Strict Network vs Timeout race to prevent HUD blocking on poor cellular signals
    else if (url.hostname.includes('api.open-meteo.com')) {
        e.respondWith(
            new Promise((resolve) => {
                let isResolved = false;
                const timeoutId = setTimeout(() => {
                    if (!isResolved) {
                        caches.match(e.request).then(cachedRes => {
                            if (cachedRes) {
                                isResolved = true;
                                resolve(cachedRes);
                            }
                        });
                    }
                }, 2500); // 2.5s threshold for tactile feedback
                
                fetch(e.request).then(netRes => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);
                        caches.open(APP_CACHE).then(cache => cache.put(e.request, netRes.clone()));
                        resolve(netRes);
                    }
                }).catch(() => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);
                        caches.match(e.request).then(resolve);
                    }
                });
            })
        );
    } 
    // ALL OTHER REQUESTS: Network First, Cache Fallback
    else {
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    // Allow valid responses (200) and opaque responses (0, typical for no-cors CDNs)
                    if (!response || (response.status !== 200 && response.status !== 0)) {
                        return response;
                    }

                    // Prevent caching of unsupported schemes (like chrome-extension://)
                    if (!e.request.url.startsWith('http')) {
                        return response;
                    }

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