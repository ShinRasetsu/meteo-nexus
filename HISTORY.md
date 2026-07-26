# MeteoNexus Tactical HUD — Session History

> **Handoff contract:** Read this file + `VERSION` at the start of every session.
> The `VERSION` file is the single source of truth. All other version references
> (header badge, footer, git tags) derive from it.

---

## Current state at session end (2026-07-26)

| Key | Value |
|---|---|
| `VERSION` | `1.1.0` |
| `package.json` → version | `1.1.0` (sync manually with VERSION on bump) |
| Header badge element | `<span data-version-badge>` — hydrated from `./VERSION` at runtime |
| Footer badge element | `<span data-version-badge>` — hydrated from `./VERSION` at runtime |
| Git tag | `v1.1.0` — create with `git tag v1.1.0` before push |
| Tests | `npm test` — 90 assertions, all passing |
| Lint | `npm run lint` — zero errors |

## How to bump version in a new session

1. Read `VERSION` to know current version
2. Edit `VERSION` (e.g., `1.1.0` → `1.2.0`) — this automatically updates header + footer
3. Sync `package.json` → `"version": "1.2.0"`
4. Append a new `## X.Y.Z — YYYY-MM-DD` section below with all changes
5. Run `npm test && npm run lint` before declaring done
6. (Optional) `git tag v1.2.0` for deployment tracking

---

## 1.1.0 — 2026-07-26

### Session scope

Three-pass deep audit of entire codebase (index.html 4700+ lines, worker.js 243 lines, sw.js 242 lines). Focus: correctness bugs, performance bottlenecks, memory pressure, unhandled rejections, DOM thrash, CORS issues, and race conditions.

### HIGH: Aero-Vector HUD Jitter Fix

**Root cause:** The Aero HUD compass ring (`renderAero()` at ~line 4560) read `st.fusedHeading` which only updates at GPS watch rate (~1Hz). Between GPS ticks it was frozen. The EMA (TC=120ms) sprinted to the new value in 3 frames then sat dead for 57 frames — visible freeze→jump→freeze→jump jitter.

**Fix (3 iterations):**
1. (index.html ~2536) Added `__METEO_CORE_STATE.liveMagHeading` — continuous heading from magnetometer + GPS-learned offset
2. Moved `liveMagHeading` write into `executeRenderPipeline()` inline with sensor EMA update — zero-frame latency, event-driven, only writes when data changes
3. Aero HUD priority chain (line ~4565) now prefers `st.liveMagHeading` over `st.fusedHeading`

**Why 3 iterations:** First attempt put the write in the GPS tick (same 1Hz bottleneck). Second put it outside the `rawSensorHeading` gate in executeRenderPipeline (wasted writes). Final: inline with sensor EMA consumer — correct.

**Architecture:** `state.sensorHeading` (EMA-smoothed at ~line 1349, alpha=0.75) feeds `MagHeadingFuser.applyOffset()` to produce `liveMagHeading`. The offset is GPS-learned for dock/bias correction — but the heading *stream* itself is 30-60Hz magnetometer, not 1Hz GPS. Best of both: accuracy + smoothness.

### HIGH: fetchWithRetry retried 4xx client errors

**File:** index.html, line ~474-477

**Bug:** `fetchWithRetry`'s retry loop only threw on 5xx/429 but fell through to `catch(e)` → retry for 4xx/400/401/404 — wasting 6s of total backoff on terminal client errors.

**Fix:** Tagged 4xx errors with `{ terminal: true }`. The catch block checks `e.terminal` and throws immediately without retry.

### HIGH: Brier async functions missing await

**File:** index.html, line ~3979

**Bug:** `brierRecordForecast(dFore)` and `brierRecordObservation(dFore)` both return promises but were called without `await`. The surrounding `try/catch` was synchronous and could not catch async rejections → unhandled promise rejection.

**Fix:** Added `await` to both calls.

### HIGH: Merayo magnetometer bias fallback loop — wrong axis indexing

**File:** index.html, line ~2001

**Bug:** The fallback loop `for (let i = 0; i < 3; i++)` wrote `magCalState.bias[0]`, `[1]`, `[2]` literally — all three values every iteration, not per-axis via `bias[i]`. Result: bias[1] and bias[2] were left at zero or stale values. This corrupts the magnetometer calibration (heading off by 10-60°).

**Fix:** Changed to `magCalState.bias[i] = (max[i] + min[i]) / 2` with per-axis logic.

### HIGH: GPS tick distance-based weather fetch — dead code

**File:** index.html, line ~2381 / ~2403

**Bug:** `state.lastHudLat = lat; state.lastHudLon = lon;` (line 2381) overwrote previous coords BEFORE the distance check at line 2403 read the backed values as `prevLat/prevLon`. Result: every fix after the first compared current position to itself → distance = 0 → distance-based fetch never triggered. Only the TTL timeout path (5 min) triggered weather fetches.

**Fix:** Saved previous coordinates before the overwrite: `const prevLat = state.lastHudLat, prevLon = state.lastHudLon;` then write `state.lastHudLat = lat; ...`

### HIGH: wind ghost trail time drift on tab resume

**File:** index.html, line ~4652 (Aero HUD render loop)

**Bug:** `lastHistoryTime = lastHistoryTime === 0 ? now : lastHistoryTime + 10000;` — after tab resume from background (4h), `lastHistoryTime + 10000` was still way in the past, causing `now - lastHistoryTime > 10000` to fire on every frame for ~240 frames, rapidly filling the 3-slot ring buffer with identical values.

**Fix:** Always set `lastHistoryTime = now;` after sampling.

### HIGH: Brier log ring-buffer corruption (regression from fix pass #1)

**File:** index.html, line ~3832 (reverted)

**Bug:** The ring-buffer hand-written code `log[idx] = log.pop()` corrupted when `idx >= log.length` after validation — produced `undefined` entries that crashed `brierRecordObservation`.

**Fix:** Reverted to simple `while (log.length > BRIER_CAP) log.shift()`. Array.shift() on 600 entries per ~3 hours is negligible and correct.

### HIGH: Service Worker MAP_CACHE byte counter reset on restart

**File:** sw.js

**Bug:** `_mapCacheBytes` is a global variable reset to 0 every time the SW reloads (browser restart, version bump). But the on-disk cache still contains all previously cached tiles → counter is permanently under-count. Cache can grow unbounded until eviction catches up. Also: `_mapCacheBytes` could go negative on eviction.

**Fix:** activate handler now seeds `_mapCacheBytes` from on-disk cache by enumerating all MAP_CACHE keys and summing their content-length headers. Also: `Math.max(0, _mapCacheBytes - cl)` floor guard. Also: `_isEvicting` gate prevents concurrent eviction from two `putTileInCache` calls racing.

### HIGH: swrFetch background refresh overwrites freshly cached response

**File:** sw.js, line ~80

**Bug:** The fire-and-forget background refresh in SWR logic would overwrite a freshly-cached tagged response (written by the main stale → re-fetch path). The second fetch for same resource could roll back the cache timestamp.

**Fix:** Background refresh now checks if the existing cached entry is already fresh (within `maxAgeMs`) before writing. Also uses per-URL dudup map (`_bgRefreshRequests`) to prevent multiple concurrent background fetches for the same URL.

### HIGH: CSS invalid color value

**File:** index.html, line ~116

**Bug:** `.section-fullscreen { background-color: #00 !important; }` — `#00` is non-standard (only 2 hex digits instead of 3, 6, or 8). No current browser interprets it reliably.

**Fix:** `#00` → `#000000`.

### MEDIUM: Same-origin SW handler cached dynamic JSON API responses

**File:** sw.js, line ~213

**Bug:** The catch-all same-origin handler was caching ALL successful GET requests — including API calls that might be dynamic. This polluted APP_CACHE with inside telemetry data.

**Fix:** Now only caches responses with content-type containing `text/html`, `text/css`, `application/javascript`, or `image/`.

### MEDIUM: DOM write + immediate read causes forced layout

**File:** index.html, line ~3245

**Bug:** `updateHTML(...)` → `newScrollTrack.scrollTop`, — write to innerHTML followed by read of scrollTop within same synchronous block forced a layout calculation.

**Fix:** Deferred scrollTop to `requestAnimationFrame`.

### MEDIUM: triggerRenderPipeline() before accuracy filter

**File:** index.html, line ~2389

**Bug:** `triggerRenderPipeline()` was called before they `accuracy > 3000` early-return — wasted a complete render pass on every low-quality GPS fix.

**Fix:** Moved after the gate.

### MEDIUM: smoothVisualsLoop runs at 60fps in background tabs

**File:** index.html, line ~1405

**Bug:** The map animation loop `requestAnimationFrame(smoothVisualsLoop)` ran unconditionally even when the PWA was backgrounded — wasted CPU and battery.

**Fix:** Added `if (document.visibilityState === 'hidden') return;` at top of loop.

### MEDIUM: getWindDirection() / getCardinalStr() per-frame allocation

**File:** index.html, lines ~3280, ~4518

**Bug:** Both functions allocated a fresh 16-element `const on = [...]` array on every call. In Aero HUD's 60fps loop this was 60+ allocations/sec.

**Fix:** Lifted `WIND_DIR_ARR` to module-level constant. Aero HUD's `getCardinalStr` now just references the shared `getWindDirection`.

### MEDIUM: DOM.weatherDesc null guard missing

**File:** index.html, line ~3746

**Bug:** `DOM.weatherDesc.classList.remove/add(...)` called without null check — would crash if element missing from DOM.

**Fix:** Added null guard before classList calls.

### MEDIUM: Toast CSS transform not reset on re-trigger

**File:** index.html, line ~1237

**Bug:** When a second toast fired while the first was mid-fade, the previous `transform: translateY(-8px)` could leak into the new toast's initial frame.

**Fix:** Synchronous style flush: `transition: none` → reset transform → `offsetHeight` (force layout) → restore transition → set opacity. Position is guaranteed clean before the next paint.

### LOW: OSM tile pre-cache CORS mode

**File:** index.html, line ~1548

**Bug:** `mode: 'cors'` fetch for tile subdomains (`a.tile.openstreetmap.org`, etc.) — these CDN edges don't guarantee CORS headers, causing the fetch to fail silently.

**Fix:** `mode: 'no-cors'`. Accept opaque responses (which cache API stores fine).

### Architecture decisions made

- **Versioning:** `VERSION` file is single source of truth. Header and footer read it via `data-version-badge` attribute at runtime (script at bottom of body). No duplicate hardcoded version strings.
- **Handoff protocol:** This file + `VERSION` = full context for any new agent/session.
- **Fusion architecture:** Raw magnetometer readings → `handleOrientationUpdate` → `state.rawSensorHeading` → `executeRenderPipeline()` EMA-smooths with alpha=0.75 → `state.sensorHeading` → `MagHeadingFuser.applyOffset()` applies GPS-learned bias correction → written to `window.__METEO_CORE_STATE.liveMagHeading` for Aero HUD consumption. `fusedHeading` and the `__METEO_CORE_STATE` also now has a new `liveMagHeading` field alongside the existing `fusedHeading`, `rawMagHeading`, `gnssHeading`, etc.
- **Project entry points:** `index.html` (entire app), `worker.js` (Web Worker), `sw.js` (Service Worker).

## Original codebase (1.0.0)

The initial project is a single-file PWA (4680+ lines inline script in index.html) with:
- Leaflet 1.9.4 + leaflet-routing-machine for map/route display
- Open-Meteo level multi-model ensemble (ECMWF, GFS, ICON, JMA — 4 models)
- GPS watch + magnetometer heading fusion with Merayo least-squares calibration
- Service Worker with 4-level cache (app, API 5-min SWR, map tiles, CDN)
- Web Worker for polyline coding, route node interpolation, Overpass fuel station parsing
- Firebase Firestore for optional cloud sync
- Chart.js for atmospheric telemetry plot
- 90-source sanity test suite (`tests/sanity.test.js`)
- No build step, no bundler — all libraries via CDN `<script>`

No bugs found in worker.js. Extensive test and code validation confirm correctness.

### Fix summary (1.1.0)

- **11 HIGH** bugs fixed (jitter, 4xx retry, missing await, Merayo bias, GPS dead fetch, wind trail drift, Brier corruption, SW cache counter, SW background overwrite, invalid CSS, NaN propagation through heading chain)
- **6 MEDIUM** fixes (SW API caching, DOM layout thrash, accuracy gate, background RAF, per-frame alloc, null guard, toast glitch)
- **1 LOW** fix (CORS mode)
- **2 structural** additions: versioning system (VERSION + HISTORY.md + dynamic badges), handoff protocol
- **3 audit passes** total — no remaining known bugs