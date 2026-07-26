# History

## 1.1.0 — 2026-07-26

### Deep Audit & Performance Pass (opencode #1)

**Aero-Vector HUD Jitter Fix**
- Compass ring now reads `liveMagHeading` at magnetometer rate (30-60Hz) instead of `fusedHeading` at GPS rate (1Hz)
- `liveMagHeading` writes inline with sensor EMA in `executeRenderPipeline` — zero-frame latency
- `__METEO_CORE_STATE.liveMagHeading` fed from `sensorHeading + MagHeadingFuser.applyOffset`

**Corrective Pass #1 (HIGH)**
- `fetchWithRetry`: 4xx client errors no longer retried (was wasting 6s on terminal errors)
- Brier `brierRecordForecast/Observation`: added missing `await` — prevents unhandled rejections
- SW MAP_CACHE byte counter: seeds from disk on activate (was resetting to 0 on restart)
- SW `swrFetch` background refresh: checks freshness before overwriting + per-URL dedup
- SW `_mapCacheBytes`: `Math.max(0, ...)` floor guard against negative
- SW concurrent eviction: `_isEvicting` gate flag
- SW same-origin handler: only caches html/css/js/images, skips dynamic API
- `triggerRenderPipeline()` moved after accuracy filter (was wasted on low-quality GPS fixes)
- GPS tick: saves previous coords before overwrite so distance-based weather fetch works
- Tile pre-cache: `mode: 'no-cors'` for OSM CDN tiles (was failing silently with `cors`)
- SW activate: byte-counter seed from on-disk cache

**Correctness Pass #1 (MEDIUM)**
- Timeline `innerHTML` + `scrollTop`: deferred to `requestAnimationFrame` (forced layout fix)
- Brier log `Array.shift()`: replaced with O(1) ring-buffer (reverted to simple shift in pass #2)
- smoothVisualsLoop: bails on `visibilityState === 'hidden'` (was 60fps in background tabs)
- `getWindDirection`: lifted `WIND_DIR_ARR` to module-level const — no per-call allocation

**Correctness Pass #2 (HIGH)**
- CSS invalid `#00` → `#000000`
- Merayo bias fallback loop: per-axis indexing using loop variable `i` (was writing `bias[0]` 3 times)
- Wind ghost trail history: `lastHistoryTime` always reset to `now` (was causing rapid-fire on tab resume)

**Correctness Pass #2 (MEDIUM)**
- `DOM.weatherDesc` null guard for `classList.remove/add`
- Toast CSS transform: synchronous style flush on re-trigger (was positional glitch)

**Versioning & Project Structure**
- `VERSION` file at root — single source of truth for deployed version
- `HISTORY.md` — changelog tracking every audit and fix
- `package.json` bumped to `1.1.0`
- Version badge in header (`v1.1.0`) and footer (`v1.1.0` at bottom of PWA)