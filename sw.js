const APP_CACHE = 'meteonexus-app-v6';
const API_CACHE = 'meteonexus-api-cache-v2';
const MAP_CACHE = 'meteonexus-map-cache';
const CDN_CACHE = 'meteonexus-cdn-cache-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './worker.js',
    './sw.js',
    './tailwind.min.css',
    './icon-192.png',
    './icon-512.png'
];

// CDN assets that ship the app shell. Pre-caching them on install lets the app
// boot fully offline the first time it loads after SW install, and shrinks the
// network-dependent critical path on repeat loads to ~0 bytes.
const CDN_PRECACHE = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        // Pre-cache app shell + leaflet/routing/chart/tailwind/fontawesome/localforage libs.
        // Each precache is wrapped in a try/catch so a single offline CDN failing
        // (e.g. jsdelivr down) does not block SW activation.
        const appCache = await caches.open(APP_CACHE);
        await Promise.all(STATIC_ASSETS.map(async (url) => {
            try { await appCache.add(url); } catch { /* no-op */ }
        }));
        const cdnCache = await caches.open(CDN_CACHE);
        await Promise.all(CDN_PRECACHE.map(async (url) => {
            try { await cdnCache.add(url); } catch { /* no-op */ }
        }));
        // Defer activation — skipWaiting is handled by SKIP_WAITING message
        // from the updatefound controllerchange listener in the main thread.
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
    let cachedTime = 0;
    if (cachedRaw) {
        const tsStr = cachedRaw.headers.get('X-SW-Cached-At');
        cachedTime = tsStr ? parseInt(tsStr, 10) : 0;
    }
    // Fresh enough — return cached immediately, update cache in background.
    const isFresh = cachedRaw && (Date.now() - cachedTime) < maxAgeMs;
    if (isFresh) {
        // Fire-and-forget background refresh — the SWR pattern's core optimization.
        fetch(request).then(netRes => {
            if (netRes && netRes.ok) {
                const clone = netRes.clone();
                const headers = new Headers(clone.headers);
                headers.set('X-SW-Cached-At', String(Date.now()));
                const tagged = new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers });
                cache.put(request, tagged).catch(() => {});
            }
        }).catch(() => {});
        return cachedRaw;
    }
    // Stale or no cache — wait on network, fall back to cached if it fails.
    try {
        const netRes = await fetch(request);
        if (netRes && netRes.ok) {
            const clone = netRes.clone();
            const headers = new Headers(clone.headers);
            headers.set('X-SW-Cached-At', String(Date.now()));
            const tagged = new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers });
            cache.put(request, tagged).catch(() => {});
            return netRes;
        }
    } catch { /* network unreachable — fall through to cached or 503 */ }
    if (cachedRaw) return cachedRaw;
    return new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
}

// MAP_CACHE byte-budget tracking — maintains a running total so the
// LRU prune never needs to clone+measure every cached response body (which
// spikes ~30 MB on a 2000-tile cache). Each cache.put reads Content-Length
// from the fetch response; each cache.delete decrements the counter.
// Soft cap at 50 MB keeps the origin well under the shared Cache-Storage quota.
let _mapCacheBytes = 0;
const MAP_CACHE_MAX_BYTES = 50 * 1024 * 1024;

async function putTileInCache(cache, req, fetchRes) {
    const cl = parseInt(fetchRes.headers.get('content-length'), 10);
    _mapCacheBytes += cl > 0 ? cl : 15000;  // consistent fallback for insert and evict
    await cache.put(req, fetchRes.clone());
    if (_mapCacheBytes > MAP_CACHE_MAX_BYTES) await evictOldestTiles(cache);
}
async function evictOldestTiles(cache) {
    const keys = await cache.keys();
    keys.sort(); // by URL string — evicts lower z/x/y tiles first (larger-scale, coarser detail)
    for (const req of keys) {
        if (_mapCacheBytes <= MAP_CACHE_MAX_BYTES) break;
        const res = await cache.match(req);
        if (!res) continue;
        const cl = parseInt(res.headers.get('content-length'), 10) || 15000;
        await cache.delete(req);
        _mapCacheBytes -= cl;
    }
}

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

// MAP TILE CACHE: Cache First, Network Fallback.
        // Byte-budget tracked in-memory; tile bodies are never cloned just to
        // measure size. Existence checked before cache.put to skip wasteful
        // Response.clone() on already-cached tiles.
        if (url.hostname.includes('tile.openstreetmap.org')) {
            e.respondWith((async () => {
                const cached = await caches.match(e.request);
                if (cached) return cached;
                try {
                    const netRes = await fetch(e.request);
                    if (netRes.ok) {
                        const cache = await caches.open(MAP_CACHE);
                        const hit = await cache.match(e.request);
                        if (!hit) await putTileInCache(cache, e.request, netRes);
                    }
                    return netRes;
                } catch {
                    return new Response(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#111"/><text x="128" y="128" fill="#333" font-family="monospace" font-size="14" text-anchor="middle">OFFLINE</text></svg>',
                        { headers: { 'Content-Type': 'image/svg+xml' } }
                    );
                }
            })());
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
                // Only cache true navigation/document requests to APP_CACHE; leave API/tile handlers above.
                const cache = await caches.open(APP_CACHE);
                cache.put(e.request, response.clone()).catch(() => {});
                return response;
            } catch {
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
