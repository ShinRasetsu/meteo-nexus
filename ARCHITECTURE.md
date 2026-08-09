# Architecture

This document describes the structural shape of the app. `HISTORY.md` explains *why* it looks the way it does; this document explains *what* it is.

## High-level diagram

```
┌───────────────────────────── index.html ─────────────────────────────┐
│                                                                       │
│  <head>                                                               │
│    CSP meta tag (strict)                                              │
│    <link rel="modulepreload" integrity=sha384 …>  ← Firebase          │
│    <script defer src="…"> ← Leaflet, Chart, localforage (NO SRI yet)   │
│    <style>            ← ~104 lines of inline CSS                      │
│    inline <script>    ← THEME_COLORS + window.__METEO_CORE_STATE init  │
│                                                                       │
│  <body>                                                               │
│    markup                                                            │
│    <script type="module">  ← THE ENGINE, lines 520–5590 (~5100 lines) │
│  ...                                                                  │
│                                                                       │
│    /static assets fetch ──→  sw.js  (Service Worker)                  │
│    /postMessage        ──→  worker.js  (Web Worker, math kernel)        │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ dynamic import('https://www.gstatic.com/...')
                                 ▼
                          Firebase Auth + Firestore (anonymous)
```

## Inline-engine section map

The inline `<script type="module">` block is organised by `// --- BANNER ---` comment sections. Approximate line numbers (current as of v1.3.8):

| Line | Section | Lines | Notes |
|---:|---|---:|---|
| 523 | FETCH WRAPPER | ~42 | `fetchWithRetry`, AbortController, exponential backoff with jitter |
| 566 | REGEXP INSTANCES | ~13 | Cached regex objects |
| 580 | CLOUD INIT | ~43 | `app, auth, db` module singletons; `signInAnonymously` + `onAuthStateChanged` |
| 624 | WEATHER ENSEMBLE ENGINE | ~400+ | Biggest block — `WeatherEnsemble` object + regional weights |
| 1046 | CONFIG | ~10 | `CONFIG.weatherApi`, `CONFIG.cacheTTL` |
| 1058 | COMPUTE WORKER BRIDGE | ~80 | `workerPending` Map; `WORKER_TASK_TIMEOUT_MS` |
| 1139 | WMO LOOKUP TABLES | ~40 | `WMO_CODES`, `WMO_ICONS`, `WMO_RAIN_CODES` |
| 1219 | STATE STORE | ~85 | `let state = { ... }` — main module-local state, ~30 fields |
| 1304 | DOM REFS | ~80 | `const DOM = {}` — cached `getElementById` (~40 refs) |
| 1525 | RENDER PIPELINE | ~185 | `executeRenderPipeline` (rAF) |
| 1585 | smoothVisualsLoop | – | rAF; visibility-gated; deadband `VISUAL_DEADBAND_SQ = 1e-13` |
| 1908 | MAGNETOMETER CALIBRATION MODULE | ~435 | `magCalState`, deviceorientation handlers |
| 2551 | HEADING FUSION | – | `MagHeadingFuser` |
| 2723 | GPS TRACKING ENGINE | ~560 | `watchPosition` + `processNodes` |
| 3283 | ROUTE INTELLIGENCE FETCH | – | Valhalla / OSRM / Overpass + worker bridge |
| 3407 | ROUTE INTEL TIMELINE RENDERER | ~230 | |
| 1267 | `findHourIndexForUnixMs` helper | – | O(log n) binary search (replaced former per-frame O(n) scans) |
| 3641 | CLOCK | – | `syncClock` — recursive setTimeout, not setInterval |
| 3736 | CHART | – | Chart.js init / update |
| 3896 | NORMALIZE TELEMETRY | ~263 | `normalizeTelemetryData` — central transform |
| 4159 | RENDER TELEMETRY UI | ~200 | |
| 4363 | PROCESS TELEMETRY PAYLOAD | – | Writes to `__METEO_CORE_STATE` |
| 4596 | FETCH DATA | ~82 | `Promise.race([fetchBundle, WEATHER_FETCH_BUDGET_MS])` |
| 4699 | FUEL MANAGER | – | |
| 4886 | APP INIT | – | `runApp()` (waits for `checkDependenciesAndRun` to confirm globals loaded) |
| 4939 | PWA | ~60 | Service worker registration; install prompt; cache gauge |
| 4998 | ACTIVE AERO TELEMETRY EXTENSION | ~590 | Self-contained IIFE; own rAF, state, DOM cache; reads `__METEO_CORE_STATE` |

Total inline module: ~5100 lines, ~330 KB of JS.

## State surfaces

State is intentionally split across four surfaces; none is the sole source of truth.

| Surface | Where | Role |
|---|---|---|
| `window.__METEO_CORE_STATE` | `index.html:47` (declared in `<head>`, outside module) | Cross-module bridge — the Aero HUD IIFE reads this on every rAF tick. ~25 fields: `gnssHeading`, `fusedHeading`, `smoothing`, weather code/precip/temp, `tempTrend`, `utcOffsetSec`, etc. |
| `let state = { ... }` | `index.html:1220` (module-local) | Main engine state, ~30 fields. Includes `renderPending`, `mapObj`, `routeCtrl`, `fuelMarkers`, `gpsWatchId`, `userAuth`, etc. |
| `magCalState` | `index.html:1927` | Magnetometer calibration state: `bias`, `scale`, `samples`, `quality`, `capturing`, `rafId` |
| `_uiCache` | `index.html:5227` (Aero HUD IIFE) | 60fps DOM write-cache: `alt`, `windSpeed`, `ringTrans`, `glanceRain`, etc. — prevents `innerHTML` writes when nothing changed |
| Module singletons | `computeWorker`, `workerPending` Map, `_brierCache`, `windHistory` Float32Array, `mapHoldTimer` | Module-scope mutable singletons |

The contract: `__METEO_CORE_STATE` is the *read surface* for cross-module consumers; the module-local `state` and the singletons own their own writes and publish selected fields into `__METEO_CORE_STATE` for cross-module consumption.

## Render pipeline

Two rAF loops + zero `setInterval`:

1. **`executeRenderPipeline`** (`index.html:1527`) — cheap state propagation; runs once per frame.
2. **`smoothVisualsLoop`** (`index.html:1585`) — main visual lerp; visibility-gated, deadband-gated, self-reschedules via rAF. Pre-allocates `visualLastMarkerTX/Y` so no per-frame allocation.
3. **`renderAero`** (`index.html:5248`) — Aero HUD overlay; lives inside the second IIFE; visibility-gated; has `aeroRafScheduled` latch to prevent double-scheduling.

All timers (`syncClock`, `checkDependenciesAndRun`, magcal auto-stop) are **self-rescheduling `setTimeout`**, never `setInterval`. This means a `visibilitychange` listener can Short-circuit them cleanly.

## Async / fetch patterns

- `fetchWithRetry` (`index.html:524`) — AbortController with `AbortSignal.any` fallback; exponential backoff with jitter; `e.terminal` short-circuit; `AbortError` re-throw (per `HISTORY.md:212-213`).
- Main weather fetch (`fetchData`, `index.html:4596`) — `Promise.race([fetchBundle, WEATHER_FETCH_BUDGET_MS = 8000])`; on budget timeout the cached payload renders and the network attempt keeps running.
- Firebase (`index.html:580-`) — `onAuthStateChanged` is registered **before** `signInAnonymously()` so the subscriber owns the `isCloudActive` flip (per `HISTORY.md:299`).
- Worker bridge (`index.html:1058`) — `postMessage` to `worker.js` with `messageId` correlation; `WORKER_TASK_TIMEOUT_MS = 25000` budget; `workerPending` Map for outstanding requests.
- Service Worker (`sw.js`) — `CACHE_STATS` message protocol; the page queries tile-cache bytes/tile-count to render the "23.1/50MB · 142 tiles" gauge.

## Cache strategy (Service Worker)

`sw.js` maintains four caches, each with a distinct strategy:

| Cache name | Strategy | Used for |
|---|---|---|
| `meteonexus-app-v6` | Cache First (network on navigation only) | App shell: `index.html`, `manifest.json`, `worker.js`, icons |
| `meteonexus-api-cache-v2` | Stale-While-Revalidate (5 min freshness) | open-meteo, Overpass, Valhalla, BigDataCloud |
| `meteonexus-map-cache` | Cache First, Network Fallback, byte budget 50 MB | `*.tile.openstreetmap.org` tiles; LRU eviction by URL sort |
| `meteonexus-cdn-cache-v1` | Cache First, Network Fallback, precached on install | Leaflet, Chart, Font Awesome, localforage |

The `_mapCacheBytes` counter survives SW restarts via on-disk seed-on-activate (`sw.js:62-72`).

## Worker offload (`worker.js`)

Three task types dispatched via `self.onmessage`:

- `DECODE_VALHALLA` — Valhalla polyline decode; pre-allocates `Float64Array` to avoid per-pair allocation in the hot loop.
- `CALCULATE_NODES` — route node interpolation at fixed interval along cumulative haversine distance.
- `PROCESS_OVERPASS` — bounded top-K insertion sort (K=32); in-place strict-filter on `isExact`.

The `fastDistance` haversine helper is **duplicated** in `worker.js:10` (worker scope can't share main-thread scope) — keep these in sync if you touch one.

## Known architectural ceiling

The single inline `<script type="module">` block (520 → 5590) creates the failure surface that the audit pipeline was built to defend against:

- **No bundler, no minification, no tree-shaking** of the engine. `tailwind.min.css` is the only built artefact.
- **`'unsafe-inline'` in CSP** (`index.html:8`) is required because the engine is inlined. Removing this relaxation requires extracting the engine to an external `.js` file.
- **The audit scanners exist because standard tooling can't see inside the inline block.** `node --check` on a single file works once you extract; ESLint's `no-use-before-define` doesn't catch same-block-scope TDZ; manual `grep` for `{` / `}` is insufficient when regex literals and template literals are in play.

See `HISTORY.md:414-428` (1.3.0 missing `}`) and `HISTORY.md:431-465` (1.3.3 TDZ + silent catch) for the two ship-breakers that motivated the scanner pipeline.
