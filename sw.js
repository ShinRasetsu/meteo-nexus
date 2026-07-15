const APP_CACHE = 'meteonexus-app-v6';
const API_CACHE = 'meteonexus-api-cache-v2';
const MAP_CACHE = 'meteonexus-map-cache-v2';

// Cache limits
const MAX_API_CACHE_ENTRIES = 60;
const MAX_MAP_CACHE_ENTRIES = 200;

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './worker.js',
    './sw.js',
    // CDN dependencies — precached so first load works offline
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
    'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js'
];

// Stale-While-Revalidate for assets, Network-First for API
const CACHE_STRATEGIES = {
    'tile.openstreetmap.org': 'cache-first',
    'api.open-meteo.com': 'network-first',
    'overpass-api.de': 'network-first',
    'valhalla': 'network-first',
    'default': 'network-first'
};

// Hostname memoization — avoid new URL() on every fetch
const HOSTNAME_CACHE = new Map();
function getHostname(url) {
    let h = HOSTNAME_CACHE.get(url);
    if (h) return h;
    try { h = new URL(url).hostname; } catch { h = ''; }
    HOSTNAME_CACHE.set(url, h);
    return h;
}

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
                if (![APP_CACHE, API_CACHE, MAP_CACHE].includes(k)) return caches.delete(k);
            })
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function getStrategy(url) {
    const hostname = getHostname(url);
    for (const [key, strategy] of Object.entries(CACHE_STRATEGIES)) {
        if (hostname.includes(key)) return strategy;
    }
    return CACHE_STRATEGIES.default;
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const network = await fetch(request);
        if (network.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, network.clone());
        }
        return network;
    } catch {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#111"/><text x="128" y="128" fill="#333" font-family="monospace" font-size="14" text-anchor="middle">OFFLINE</text></svg>', 
            { headers: { 'Content-Type': 'image/svg+xml' } });
    }
}

async function networkFirst(request, cacheName, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const network = await fetch(request, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (network.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, network.clone());
            await evictIfNeeded(cacheName, cache);
        }
        return network;
    } catch (err) {
        clearTimeout(timeoutId);
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: err.name === 'AbortError' ? 'timeout' : 'offline' }), 
            { status: err.name === 'AbortError' ? 504 : 503, headers: { 'Content-Type': 'application/json' } });
    }
}

async function evictIfNeeded(cacheName, cache) {
    const limit = cacheName === API_CACHE ? MAX_API_CACHE_ENTRIES : 
                  cacheName === MAP_CACHE ? MAX_MAP_CACHE_ENTRIES : Infinity;
    if (limit === Infinity) return;
    const keys = await cache.keys();
    if (keys.length > limit) {
        await cache.delete(keys[0]); // FIFO eviction
    }
}

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    
    const url = e.request.url;
    const strategy = getStrategy(url);
    const hostname = getHostname(url);
    const isApi = hostname.includes('api.open-meteo.com') || hostname.includes('overpass-api.de') || hostname.includes('valhalla');
    const cacheName = isApi ? API_CACHE : (hostname.includes('tile.openstreetmap.org') ? MAP_CACHE : APP_CACHE);
    
    if (strategy === 'cache-first') {
        e.respondWith(cacheFirst(e.request, cacheName));
    } else {
        e.respondWith(networkFirst(e.request, cacheName));
    }
});