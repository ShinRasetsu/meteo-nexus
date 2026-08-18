const APP_CACHE = 'meteonexus-app-v7';
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
    './icon-512.png',
    './icon-180.png',
    // FIX-1.4.1c (A-2): the offline fuel-station datasets (2.8 MB Shell +
    // 0.65 MB Caltex) are the core of the fuel-intercept feature but were
    // never precached — a fresh offline install had zero fuel data and the
    // feature silently degraded to Overpass-network. Precache them like the
    // app shell; the 7-day localforage freshness layer is unchanged.
    './shell_stations.json',
    './caltex_stations.json'
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

// Seed the in-memory MAP_CACHE byte counter from on-disk entries. Shared by
// activate (so the LRU budget survives SW restarts) and the CACHE_STATS
// resync path (so offline tile downloads / map-cache clears — which the SW
// never sees via fetch — are reflected in the counter and gauge immediately).
async function seedMapCacheBytes() {
    try {
        const mapCache = await caches.open(MAP_CACHE);
        const tileReqs = await mapCache.keys();
        for (const req of tileReqs) {
            const res = await mapCache.match(req);
            if (res) {
                const cl = parseInt(res.headers.get('content-length'), 10) || 15000;
                _mapCacheBytes += cl;
            }
        }
    } catch { /* seed fails silently — counter starts at 0, self-heals over time */ }
}

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => {
            if (![APP_CACHE, API_CACHE, MAP_CACHE, CDN_CACHE].includes(k)) return caches.delete(k);
        }));
        // Seed the in-memory byte counter from the on-disk MAP_CACHE so the
        // LRU budget survives SW restarts and version bumps. Without this,
        // the counter resets to 0 and the cache grows unbounded until the
        // eviction logic catches up from scratch.
        await seedMapCacheBytes();
        // Same seeding for the API byte counter (entries carry content-length
        // headers, so no body cloning is needed).
        try {
            const apiCache = await caches.open(API_CACHE);
            const apiReqs = await apiCache.keys();
            for (const req of apiReqs) {
                const res = await apiCache.match(req);
                if (res) {
                    const cl = parseInt(res.headers.get('content-length'), 10) || 15000;
                    _apiCacheBytes += cl;
                }
            }
        } catch { /* seed fails silently — counter starts at 0, self-heals over time */ }
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
        // Background refresh — checks freshness to avoid overwriting a tag
        // the main path just stored (stale-then-fresh race). Deduplicated so
        // rapid repeat requests only spawn one background fetch.
        _bgRefreshRequests = _bgRefreshRequests || new Map();
        const bgUrl = request.url;
        if (!_bgRefreshRequests.has(bgUrl)) {
            _bgRefreshRequests.set(bgUrl, true);
            const bgController = new AbortController();
            const bgTimeout = setTimeout(() => bgController.abort(), 10000);
            fetch(request, { signal: bgController.signal }).then(netRes => {
                clearTimeout(bgTimeout);
                _bgRefreshRequests.delete(bgUrl);
                if (netRes && netRes.ok) {
                    caches.open(cacheName).then(bgCache => bgCache.match(request).then(existing => {
                        if (existing) {
                            const tsStr = existing.headers.get('X-SW-Cached-At');
                            const existingTime = tsStr ? parseInt(tsStr, 10) : 0;
                            if (existingTime > Date.now() - maxAgeMs) return;
                        }
                        const clone = netRes.clone();
                        const headers = new Headers(clone.headers);
                        headers.set('X-SW-Cached-At', String(Date.now()));
                        const tagged = new Response(clone.body, { status: clone.status, statusText: clone.statusText, headers });
                        bgCache.put(request, tagged)
                            .then(() => trackApiCachePut(bgCache, tagged))
                            .catch((e) => { console.debug('SW bg cache.put failed (intentional silencer):', e && e.message); });
                    }).catch(() => {}))
                    .catch(() => {});
                }
            }).catch(() => { _bgRefreshRequests.delete(bgUrl); });
        }
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
            cache.put(request, tagged)
                .then(() => trackApiCachePut(cache, tagged))
                .catch((e) => { console.debug('SW cache.put failed (intentional silencer):', e && e.message); });
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
let _tileEvicting = null;
const MAP_CACHE_MAX_BYTES = 50 * 1024 * 1024;
let _bgRefreshRequests = null;  // Map<url, boolean> — SWR background fetch dedup

// API_CACHE byte-budget tracking — same running-total scheme as the tile
// cache, evicting oldest-first by X-SW-Cached-At tag (URL sort is meaningless
// for telemetry/route-intel responses). Unbounded before: telemetry URLs embed
// float-precision coords and never repeat, so the cache grew ~11-18 MB/day on
// the move and ~100-150 MB/day while navigating. 25 MB keeps the origin well
// under quota while covering a multi-day offline horizon.
let _apiCacheBytes = 0;
let _apiEvicting = null;  // in-flight eviction promise (latch) — see FIX-1.4.1 (B12)
const API_CACHE_MAX_BYTES = 25 * 1024 * 1024;

async function trackApiCachePut(cache, response) {
    const cl = parseInt(response.headers.get('content-length'), 10);
    _apiCacheBytes += cl > 0 ? cl : 15000;  // consistent fallback for insert and evict
    if (_apiCacheBytes > API_CACHE_MAX_BYTES) await evictOldestApiEntries(cache);
}
async function evictOldestApiEntries(cache) {
    // FIX-1.4.1 (B12): promise latch instead of boolean — the old
    // `if (_isApiEvicting) return;` let a second concurrent caller skip
    // eviction entirely, leaving _apiCacheBytes over budget until the next
    // put happened to trigger eviction again. Callers now await the in-flight
    // eviction and re-check the budget after it settles.
    if (_apiEvicting) {
        await _apiEvicting;
        if (_apiCacheBytes <= API_CACHE_MAX_BYTES) return;
    }
    const task = (async () => {
        const keys = await cache.keys();
        const entries = [];
        for (const req of keys) {
            const res = await cache.match(req);
            if (!res) continue;
            const tsStr = res.headers.get('X-SW-Cached-At');
            const ts = tsStr ? parseInt(tsStr, 10) : 0;
            const cl = parseInt(res.headers.get('content-length'), 10) || 15000;
            entries.push({ req, cl, ts });
        }
        entries.sort((a, b) => a.ts - b.ts); // oldest first
        for (const ent of entries) {
            if (_apiCacheBytes <= API_CACHE_MAX_BYTES) break;
            await cache.delete(ent.req);
            _apiCacheBytes = Math.max(0, _apiCacheBytes - ent.cl);
        }
    })();
    _apiEvicting = task;
    try { await task; } finally { if (_apiEvicting === task) _apiEvicting = null; }
}

async function putTileInCache(cache, req, fetchRes) {
    const cl = parseInt(fetchRes.headers.get('content-length'), 10);
    _mapCacheBytes += cl > 0 ? cl : 15000;  // consistent fallback for insert and evict
    try {
        await cache.put(req, fetchRes.clone());
    } catch (e) {
        // FIX-1.4.1 (B11): a failed put (quota exceeded, etc.) must not leave
        // the byte budget inflated — the phantom bytes would trigger premature
        // evictions of perfectly good tiles on the next insert.
        _mapCacheBytes = Math.max(0, _mapCacheBytes - (cl > 0 ? cl : 15000));
        throw e;
    }
    if (_mapCacheBytes > MAP_CACHE_MAX_BYTES) await evictOldestTiles(cache);
}
async function evictOldestTiles(cache) {
    if (_tileEvicting) {
        await _tileEvicting;
        if (_mapCacheBytes <= MAP_CACHE_MAX_BYTES) return;
    }
    const task = (async () => {
        const keys = await cache.keys();
        keys.sort(); // by URL string — evicts lower z/x/y tiles first (larger-scale, coarser detail)
        for (const req of keys) {
            if (_mapCacheBytes <= MAP_CACHE_MAX_BYTES) break;
            const res = await cache.match(req);
            if (!res) continue;
            const cl = parseInt(res.headers.get('content-length'), 10) || 15000;
            await cache.delete(req);
            _mapCacheBytes = Math.max(0, _mapCacheBytes - cl);
        }
    })();
    _tileEvicting = task;
    try { await task; } finally { if (_tileEvicting === task) _tileEvicting = null; }
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

    // APP SHELL & SAME-ORIGIN: Network First, App Cache fallback.
    // Only caches HTML documents (navigation requests) and static assets — skips
    // JSON/API responses to avoid polluting APP_CACHE with dynamic telemetry data.
    if (url.origin === self.location.origin) {
        e.respondWith((async () => {
            try {
                const response = await fetch(e.request);
                if (!response || response.status !== 200) return response;
                const cType = response.headers.get('content-type') || '';
                if (cType.includes('text/html') || cType.includes('text/css') ||
                    cType.includes('application/javascript') || cType.includes('image/')) {
                    const cache = await caches.open(APP_CACHE);
                    cache.put(e.request, response.clone()).catch((err) => { console.debug('SW app cache.put failed (intentional silencer):', err && err.message); });
                }
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

// Cache stats query: page sends {type:'CACHE_STATS'} and the SW replies
// with {mapCacheBytes, max, tileCount} so the UI can render a compact
// gauge ("23/50MB · 142 tiles"). The user can see whether offline tiles
// are sufficient before driving into a dead zone.
// FIX-1.4.1b (H1/H2): the page can pass {resync:true} after it has written
// or deleted map-cache entries directly (downloadMapCache / executeMapClear
// mutate the on-disk cache the SW never sees via fetch) — the counter is
// re-seeded from disk before the reply so the gauge and LRU budget never
// drift from reality.
self.addEventListener('message', async (e) => {
    if (e.data && e.data.type === 'CACHE_STATS') {
        if (e.data.resync) {
            _mapCacheBytes = 0;
            await seedMapCacheBytes();
        }
        let tileCount;
        try {
            const c = await caches.open(MAP_CACHE);
            tileCount = (await c.keys()).length;
        } catch (_err) { tileCount = -1; } // eslint-disable-line no-unused-vars
        e.source.postMessage({
            type: 'CACHE_STATS_REPLY',
            mapCacheBytes: _mapCacheBytes,
            mapCacheMax: MAP_CACHE_MAX_BYTES,
            tileCount
        });
    }
});
