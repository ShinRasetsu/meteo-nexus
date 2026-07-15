const APP_CACHE = 'meteonexus-app-v6';
const API_CACHE = 'meteonexus-api-cache-v2';
const MAP_CACHE = 'meteonexus-map-cache-v2';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './worker.js',
    './sw.js'
];

// Stale-While-Revalidate for assets, Network-First for API
const CACHE_STRATEGIES = {
    'tile.openstreetmap.org': 'cache-first',
    'api.open-meteo.com': 'network-first',
    'overpass-api.de': 'network-first',
    'valhalla': 'network-first',
    'default': 'network-first'
};

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
    const hostname = new URL(url).hostname;
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

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    
    const url = new URL(e.request.url);
    const strategy = getStrategy(e.request.url);
    const isApi = url.hostname.includes('api.open-meteo.com') || url.hostname.includes('overpass-api.de') || url.hostname.includes('valhalla');
    const cacheName = isApi ? API_CACHE : (url.hostname.includes('tile.openstreetmap.org') ? MAP_CACHE : APP_CACHE);
    
    if (strategy === 'cache-first') {
        e.respondWith(cacheFirst(e.request, cacheName));
    } else {
        e.respondWith(networkFirst(e.request, cacheName));
    }
});