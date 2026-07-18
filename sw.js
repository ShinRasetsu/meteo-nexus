const APP_CACHE = 'meteonexus-app-v6';
const API_CACHE = 'meteonexus-api-cache-v2';
const MAP_CACHE = 'meteonexus-map-cache';
const CDN_CACHE = 'meteonexus-cdn-cache-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './worker.js',
    './sw.js'
];

// CDN assets that ship the app shell. Pre-caching them on install lets the app
// boot fully offline the first time it loads after SW install, and shrinks the
// network-dependent critical path on repeat loads to ~0 bytes.
const CDN_PRECACHE = [
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        // Pre-cache app shell + leaflet/routing/chart/tailwind/fontawesome/localforage libs.
        // Each precache is wrapped in a try/catch so a single offline CDN failing
        // (e.g. jsdelivr down) does not block SW activation.
        const appCache = await caches.open(APP_CACHE);
        await Promise.all(STATIC_ASSETS.map(async (url) => {
            try { await appCache.add(url); } catch (e) { /* no-op */ }
        }));
        const cdnCache = await caches.open(CDN_CACHE);
        await Promise.all(CDN_PRECACHE.map(async (url) => {
            try { await cdnCache.add(url); } catch (e) { /* no-op */ }
        }));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => {
            if (![APP_CACHE, API_CACHE, MAP_CACHE, CDN_CACHE].includes(k)) return caches.delete(k);
        }));
        await self.clients.claim();
    })());
});

self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Helper: timestamp-tagged cache entries so SWR can decide freshness without
// re-fetching the entire response body.
async function swrFetch(request, cacheName, maxAgeMs) {
    const cache = await caches.open(cacheName);
    const cachedRaw = await cache.match(request);
    let cached = null, cachedTime = 0;
    if (cachedRaw) {
        const tsStr = cachedRaw.headers.get('X-SW-Cached-At');
        cachedTime = tsStr ? parseInt(tsStr, 10) : 0;
    }
    // Network race in parallel with cache — return cached immediately if present
    // and staleness tolerable, otherwise race to network and update cache.
    const networkPromise = fetch(request).then(netRes => {
        if (netRes && netRes.ok) {
            // Clone + inject freshness header
            const clone = netRes.clone();
            const headers = new Headers(clone.headers);
            headers.set('X-SW-Cached-At', String(Date.now()));
            const tagged = new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers });
            cache.put(request, tagged).catch(() => {});
        }
        return netRes;
    }).catch(() => null);

    if (cachedRaw && (Date.now() - cachedTime) < maxAgeMs) {
        // Fresh enough — return cached, fire-and-forget network refresh in background.
        networkPromise.catch(() => {});
        return cachedRaw;
    }
    // Stale or no cache — wait on network, fall back to cached if it fails.
    const net = await networkPromise;
    if (net) return net;
    if (cachedRaw) return cachedRaw;
    return new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
}

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
                }).catch(() => new Response(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#111"/><text x="128" y="128" fill="#333" font-family="monospace" font-size="14" text-anchor="middle">OFFLINE</text></svg>',
                    { headers: { 'Content-Type': 'image/svg+xml' } }
                ));
            })
        );
        return;
    }

    // API REQUESTS — Stale-While-Revalidate with 5 minute freshness window.
    // Replaces the old "8s timeout race" pattern which waited for the *entire*
    // 8s before falling back to cache. SWR returns cached immediately if it's
    // recent, and refreshes in the background — much faster perceived speed for
    // repeated telemetry hits.
    if (url.hostname.includes('api.open-meteo.com') ||
        url.hostname.includes('overpass-api.de') ||
        url.hostname.includes('valhalla') ||
        url.hostname.includes('api.bigdatacloud.net')) {
        e.respondWith(swrFetch(e.request, API_CACHE, 5 * 60 * 1000));
        return;
    }

    // CDN vendor assets (tailwind/leaflet/chart/font-awesome/localforage/firebase/gstatic/fonts):
    // Cache First, Network Fallback. These are versioned & rare-change — perfect
    // for cache-first. Validates against CDN_CACHE so the precache survives.
    if (
        url.hostname.includes('cdn.tailwindcss.com') ||
        url.hostname.includes('unpkg.com') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('www.gstatic.com')
    ) {
        e.respondWith((async () => {
            const cache = await caches.open(CDN_CACHE);
            const cached = await cache.match(e.request);
            if (cached) return cached;
            try {
                const res = await fetch(e.request);
                if (res && res.ok) {
                    const clone = res.clone();
                    const headers = new Headers(clone.headers);
                    headers.set('X-SW-Cached-At', String(Date.now()));
                    const tagged = new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers });
                    await cache.put(e.request, tagged);
                }
                return res;
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
        })());
        return;
    }

    // APP SHELL & SAME-ORIGIN: Network First, App Cache fallback (with SWR-style bg refresh).
    if (url.origin === self.location.origin) {
        e.respondWith((async () => {
            try {
                const response = await fetch(e.request);
                if (!response || (response.status !== 200 && response.status !== 0)) return response;
                if (!e.request.url.startsWith('http')) return response;
                // Only cache true navigation/document requests to APP_CACHE; leave API/tile handlers above.
                const cache = await caches.open(APP_CACHE);
                cache.put(e.request, response.clone()).catch(() => {});
                return response;
            } catch (err) {
                const cached = await caches.match(e.request);
                return cached || Response.error();
            }
        })());
        return;
    }

    // All other cross-origin requests: try network, fall back to cache.
    e.respondWith((async () => {
        try {
            const response = await fetch(e.request);
            if (!response || (response.status !== 200 && response.status !== 0)) return response;
            return response;
        } catch (err) {
            const cached = await caches.match(e.request);
            if (cached) return cached;
            throw err;
        }
    })());
});
