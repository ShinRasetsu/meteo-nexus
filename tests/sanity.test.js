// Sanity test: loads index.html as text and asserts that the critical
// application-shell elements, PWA wiring, and worker dispatch entries
// are present. This is not a unit test of behaviour — it guards against
// accidental deletion of key bits (manifest link, SW registration, worker
// messages, required CDN libraries, viewport for accessibility, etc).
// Runs with plain Node (no test framework), exits non-zero on failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

let pass = 0;
let fail = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(message);
    console.error("  FAIL: " + message);
  }
}

function assertIncludes(haystack, needle, label) {
  assert(haystack.includes(needle), `${label} — expected snippet: ${needle.slice(0, 80)}${needle.length > 80 ? "..." : ""}`);
}

// ---------------------------------------------------------------------------
// index.html — app shell integrity
// ---------------------------------------------------------------------------
const html = readFileSync(join(repoRoot, "index.html"), "utf8");

assertIncludes(html, '<!DOCTYPE html>', "index.html has DOCTYPE");
assertIncludes(html, '<link rel="manifest" href="./manifest.json"', "index.html links PWA manifest");
assertIncludes(html, '<title>MeteoNexus', "index.html has <title>");

// Accessibility: viewport must NOT lock zoom (no user-scalable=no / maximum-scale=1)
assert(
  !/maximum-scale=1\.0/.test(html),
  "index.html viewport must not pin maximum-scale (WCAG 1.4.4)"
);
assert(
  !/user-scalable=no/.test(html),
  "index.html viewport must not disable user scaling (WCAG 1.4.4)"
);
assertIncludes(html, 'viewport-fit=cover', "index.html viewport uses viewport-fit=cover (notch-aware)");

// Static Tailwind (precompiled, not CDN JIT)
assertIncludes(html, './tailwind.min.css', "index.html loads precompiled tailwind.min.css");
assert(
  !/cdn\.tailwindcss\.com/.test(html),
  "index.html does NOT load the CDN Tailwind JIT (uses precompiled CSS)"
);

// Content Security Policy meta tag
assertIncludes(html, 'http-equiv="Content-Security-Policy"', "index.html has CSP meta tag");
assertIncludes(html, "www.gstatic.com", "CSP script-src permits gstatic.com (Firebase imports)");

// SRI hashes for Firebase dynamic imports (modulepreload)
assertIncludes(html, 'modulepreload', "index.html modulepreloads Firebase with SRI integrity");
assertIncludes(html, 'integrity="sha384', "Firebase modulepreload has sha384 integrity");

// Local PWA icons + iOS apple-touch-icon
assertIncludes(html, '<link rel="apple-touch-icon"', "index.html has apple-touch-icon for iOS");
assertIncludes(html, './icon-180.png', "index.html references local icon-180.png");

// No custom-auth-token injection surface
assert(
  !/__initial_auth_token/.test(html),
  "index.html does NOT expose __initial_auth_token injection surface"
);

// Firebase config must use __firebase_config_sealed guard
assertIncludes(html, "__firebase_config_sealed", "index.html guards Firebase config with __firebase_config_sealed");

// statNodes DOM keys must match HTML ids (stat-eu/us/de/jp) and render loop labels
const statElRegex = /getElementById\('stat-(\w+)'\)/g;
let statElMatch;
const statIdsInDOM = new Set();
while ((statElMatch = statElRegex.exec(html)) !== null) {
  statIdsInDOM.add(statElMatch[1]);
}
assert(
  statIdsInDOM.size >= 4 && ['eu', 'us', 'de', 'jp'].every(id => statIdsInDOM.has(id)),
  "DOM.statNodes references stat-eu, stat-us, stat-de, stat-jp (IDs match HTML)"
);

// U2-MERGE: density-by-mode + honest status wording
assertIncludes(html, 'focus-only', "index.html defines the .focus-only density-by-mode hook");
assertIncludes(html, 'id="focus-model-table"', "index.html renders the focus-only per-model table");
assertIncludes(html, '"NO RAIN"', "index.html displays NO RAIN instead of the ambiguous STABLE");
assertIncludes(html, 'id="focus-outlook"', "index.html renders the focus-only 6H rain outlook strip");
assertIncludes(html, 'id="focus-envelope"', "index.html renders the focus-only today-envelope line");

// U3-PLOT: chart relocated into the telemetry focus block; standalone section gone
assertIncludes(html, 'id="mainChart"', "index.html renders the Atmospheric Telemetry Plot canvas");
assert(
  !html.includes('id="sec-plot"') && !html.includes("toggleFocus('sec-plot')"),
  "standalone #sec-plot section is fully removed (chart lives in focus mode only)"
);
assertIncludes(html, 'sec-telemetry\' && state.chart', "focus-open resizes the hosted chart canvas");

// U5-GPS: honest boot taxonomy — timeout/unavailable must not read "GPS BLOCKED"
assertIncludes(html, 'ACQUIRING GPS', "index.html shows ACQUIRING GPS while the one-shot fix retries");
assertIncludes(html, 'err.code === err.PERMISSION_DENIED', "index.html reserves GPS BLOCKED for real permission denials");

// GPS-denied recovery: PURGE re-requests a fix, denied boot renders last-known cache
assertIncludes(html, 'requestGpsFixOnce', "PURGE flow re-requests a GPS fix before wipe+reload (re-prompts when permission is in prompt state)");
assertIncludes(html, 'renderDeniedCacheFallback', "denied boot renders the cached telemetry payload instead of sitting on an empty card");
assertIncludes(html, 'paintGpsDownFace', "blocked face is a pure painter re-asserted after the cached render (weather repaint cannot erase GPS BLOCKED)");

// GPS first-run denial recovery: purge modal is GPS-aware + permission watcher self-recovers
assertIncludes(html, 'id="purge-gps-hint"', "purge modal carries a GPS-permission status line (purging cannot reset a hard denial)");
assertIncludes(html, 'watchGeoPermissionRecovery', "geolocation permission watcher self-recovers when the user flips site settings");
assertIncludes(html, "query({ name: 'geolocation' })", "Permissions API geolocation query present (purge hint + recovery watcher)");
assertIncludes(html, 'BLOCKED BY BROWSER', "purge modal says plainly when only a site-settings flip can restore GPS");
assertIncludes(html, 'APP RESUMES AUTOMATICALLY', "denied-boot card tells the user the app self-recovers after the settings flip");

// Bug+perf audit round (post-1.10.x): verified against source before applying
assertIncludes(html, 'state.appliedHudRot = deg;', "predrag hook compensates with the rotation ACTUALLY applied to the map, not the live heading that keeps lerping during a drag");
assertIncludes(html, 'Math.ceil(nodes.length / 99)', "elevation sampler stays within Open-Meteo's 100-coordinate cap on long routes");
assertIncludes(html, 'Math.round(aeroHeading) % 360', "heading readouts wrap 360→0 instead of flashing '360°'");
assertIncludes(html, 'window._purgeRunning', "purge has a re-entry guard (modal stays open through the ≤12s GPS wait)");
assertIncludes(html, 'Local dataset unavailable', "local fuel dataset failure falls through to the Overpass fallback instead of a fake LOCAL empty");
assertIncludes(html, 'Math.floor(Date.now() / 3600000)', "chartSig carries a now-anchor so the 24h window slides across hour boundaries");
assertIncludes(html, 'Math.floor((Date.now() - t0) / 900000)', "rain ETA anchors cached minutely cells to their absolute times (1.14.1: floor, not round — the half-elapsed current cell must not be skipped)");
assertIncludes(html, 're-arm the watch UNCONDITIONALLY on a granted', "permission recovery re-arms the dead PERMISSION_DENIED watch (1.14.1: on every granted transition — a mid-session deny→regrant left autoCoords set but the watch dead)");
assert(!html.includes('wind_gusts_10m: (m15.wind_gusts_10m'), "minutely synthesis no longer materializes unread temp/wind/gust/wc lanes");

// GPS accuracy audit (1.8.2): null-safe, honest accuracy taxonomy
assertIncludes(html, 'GNSS: ACQUIRING', "null/non-finite accuracy renders ACQUIRING, not a false HIGH (0m)");
assertIncludes(html, 'GNSS: LOW (', "degraded >60m fixes are labelled LOW, not the misleading LTE/A-GPS");

// Sibling APIs (Open-Meteo family): never-throwing helper + four integrations
assertIncludes(html, "fetchSiblingJSON", "sibling-API helper never throws so a sick sibling can't break telemetry");
assertIncludes(html, "air-quality-api.open-meteo.com/v1/air-quality", "Air Quality sibling fetch present");
assertIncludes(html, "marine-api.open-meteo.com/v1/marine", "Marine sibling fetch present");
assertIncludes(html, "geocoding-api.open-meteo.com/v1/search", "Geocoding sibling fetch present");
assertIncludes(html, 'id="metric-aq"', "telemetry card renders the Air Quality row");
assertIncludes(html, 'id="sec-sea"', "telemetry card renders the Sea State section (hidden over land)");
assertIncludes(html, 'id="geo-search-input"', "map header has a place-name search box");
assertIncludes(html, "grid-cols-5", "map toolbar lays buttons in an even portrait grid (search takes its own full row)");
assertIncludes(html, "enableHighAccuracy: false", "boot takes a fast coarse fix first instead of waiting on GNSS TTFF");
assertIncludes(html, "_bootVersion", "update-available detector baselines the boot version");
assertIncludes(html, "TAP TO RELOAD", "deploys surface a one-tap reload pill instead of sitting stale");
assertIncludes(html, "closest('#geo-search-results')", "search dropdown dismisses on outside tap (once-bound)");
assertIncludes(html, "swReg.update()", "update tap chains through SW update for exactly one reload");
assertIncludes(html, "utc_offset_seconds: jMar.utc_offset_seconds", "marine keeps its UTC offset for traveler-safe hour picks");
assertIncludes(html, "Number.isFinite(state.renderAccuracy)", "coarse fixes can't seed max speed");
assertIncludes(html, "nodes[Math.floor(nodes.length / 2)]", "elevation signature covers the route middle");
assertIncludes(html, "mySeq !== _geoSeq", "stale geocoding responses lose to newer searches");

// Mobile-first pass: portrait is the primary viewport, desktop variants preserved
assertIncludes(html, "text-xl sm:text-2xl md:text-3xl", "header title scales down so 360px never overflows");
assertIncludes(html, 'Focus Telemetry" class="tap-48', "telemetry expand button meets the 48px touch target");
assertIncludes(html, "flex flex-col sm:flex-row gap-3 sm:justify-end", "modal footers stack full-width on portrait");
assertIncludes(html, "text-base md:text-sm font-bold text-white placeholder-gray-500", "search input stays 16px on mobile (no iOS focus zoom)");
assertIncludes(html, "flex flex-wrap items-center gap-x-3 gap-y-1", "telemetry sub-line wraps instead of clipping on narrow screens");
assertIncludes(html, "handleGeoSearch", "search results route through activateLiveNavigation");
assertIncludes(html, "fetchRouteElevation", "route elevation batch fetch present");
assertIncludes(html, "CLIMB +", "route timeline renders the elevation strip");
assertIncludes(html, "PM10 ${", "telemetry card renders PM10 (fetched-but-unused no more)");
assertIncludes(html, "_lastSiblingTs", "sibling APIs refresh on a 10-minute TTL, not every telemetry tick");
assertIncludes(html, "profile: prof", "route elevation keeps its climb profile for the sparkline");

// Critical CDN libs
assertIncludes(html, 'unpkg.com/leaflet@1.9.4/dist/leaflet.js', "Leaflet 1.9.4 loaded");
assertIncludes(html, 'cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', "Chart.js 4.4.1 loaded");
assertIncludes(html, 'cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js', "localforage 1.10.0 loaded");
assertIncludes(html, 'unpkg.com/leaflet-routing-machine@3.2.12', "leaflet-routing-machine 3.2.12 loaded");

// Service worker registration
assert(
  /navigator\.serviceWorker\.register\s*\(\s*['"`]\/?\.\/sw\.js['"`]/.test(html) ||
  /navigator\.serviceWorker\.register\s*\(/.test(html),
  "index.html registers a service worker"
);

// Web worker bootstrap
assertIncludes(html, "new Worker(", "index.html spawns a Web Worker");

// Core telemetry state object
assertIncludes(html, "window.__METEO_CORE_STATE", "__METEO_CORE_STATE exposed for extensions");

// Visibility-gated render loop (added in 5b patch)
assertIncludes(html, "document.visibilityState", "render loop respects visibilityState");
assertIncludes(html, "document.addEventListener('visibilitychange'", "visibilitychange listener wired");

// Weather fetch race uses AbortController to cancel on budget timeout
assertIncludes(html, "weatherAbort = new AbortController()", "weather fetch bundle has AbortController");
assertIncludes(html, "weatherAbort.abort()", "budget timeout aborts pending weather fetches");

// CSP must include gmaps-proxy for paste-link feature
assertIncludes(html, "gmaps-proxy.strikefreedomnine.workers.dev", "CSP includes gmaps-proxy for paste-link");

// DOM.modals must include magCal entry (was missing, caused crash on compass calibrate)
assertIncludes(html, "magCal:", "DOM.modals includes magCal entry");

// Offline cache timestamp passed to processTelemetryPayload
assertIncludes(html, "cachedTimestamp", "processTelemetryPayload accepts cachedTimestamp for offline nowIndex");

// Chart splice validates against old dataset length
assertIncludes(html, "oldL", "chart splice validates against chart's existing dataset length");

// Wake lock re-requests on resume (no stale null-check guard blocking)
// The guard "if (wakeLock !== null) return;" was removed from requestWakeLock
{
  const wakeLockFn = html.slice(html.indexOf('async function requestWakeLock'), html.indexOf('async function requestWakeLock') + 280);
  assert(
    !/if\s*\(wakeLock\s*!==\s*null\)\s*return/.test(wakeLockFn),
    "wakeLock requestWakeLock does not block re-request with stale null-check"
  );
}

// Overpass same-distance stations use >= for stable sort
{
  const workerSrc2 = readFileSync(join(repoRoot, "worker.js"), "utf8");
  assertIncludes(workerSrc2, "top[topCount - 1].distMeters >= d", "worker.js Top-K uses >= for same-distance stations");
}

// executeRenderPipeline no longer writes fusedHeading (only GPS tick does)
assert(
  !/"__METEO_CORE_STATE.fusedHeading\s*=\s*state\.sensorHeading/.test(html),
  "executeRenderPipeline no longer writes fusedHeading (prevents race with GPS tick)"
);

// Dead-reckoning prefers lastHeading (fresh GPS tick bearing) over visual.heading EMA
assertIncludes(html, "state.lastHeading", "dead-reckoning uses lastHeading before visual.heading");

// Dead properties removed: state.coords and timelineIdleTimer
assert(!/coords:\s*\{\}/.test(html), "state.coords dead property removed");
assert(!/timelineIdleTimer/.test(html), "state.timelineIdleTimer dead property removed");

// WeatherEnsemble _MI entries must use field 'w' (not 'weight') for consistent destructuring
// The pattern `({ m, weight })` in setActiveWeights/setActiveWeightsAtLead was a critical bug
// causing NaN weights across all ensemble math. Verify it's fixed.
{
  const setAW = html.slice(html.indexOf("this._MI = Object.entries(w).map(([m, wVal])"), html.indexOf("this._MI = Object.entries(w).map(([m, wVal])") + 120);
  assert(setAW.includes("w: wVal"), "_MI uses field 'w' (not 'weight') in setActiveWeights");
}
{
  // Find the second occurrence (setActiveWeightsAtLead)
  const firstIdx = html.indexOf("this._MI = Object.entries(w).map(([m, wVal])");
  const secondIdx = html.indexOf("this._MI = Object.entries(w).map(([m, wVal])", firstIdx + 1);
  assert(secondIdx > firstIdx, "both setActiveWeights and setActiveWeightsAtLead use 'w' field");
}

// _lastGeoLat/Lon/Name are module-scope (not function-local) — reverse-geocode gate persists across fetches
assert(
  !/"fetchData".*\n.*let _lastGeoLat/.test(html.slice(html.indexOf("async function fetchData") - 20, html.indexOf("async function fetchData") + 40)),
  "_lastGeoLat not declared inside fetchData (module scope)"
);

// loadMagCalibration called on startup (was dead code — never invoked)
assertIncludes(html, "await loadMagCalibration()", "loadMagCalibration called in runApp startup");

// CSP script-src no longer grants 'unsafe-eval' (no eval/new Function usage)
{
  const cspMatch = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/);
  assert(cspMatch, "CSP meta tag present");
  const csp = cspMatch[1];
  assert(!/unsafe-eval/.test(csp), "CSP script-src does not grant unsafe-eval");
  assert(!/kit\.fontawesome\.com/.test(csp), "CSP does not grant dead kit.fontawesome.com origin");
  assert(!/cdn\.maptiler\.com/.test(csp), "CSP does not grant dead cdn.maptiler.com origin");
  assert(!/\.github\.io/.test(csp), "CSP does not grant dead media-src *.github.io");
  assert(!/api\.maptiler\.com/.test(csp), "CSP does not grant dead api.maptiler.com");
  assert(!/nominatim/.test(csp), "CSP does not grant dead nominatim origin");
  assert(!/firebasestorage/.test(csp), "CSP does not grant dead firebasestorage origin");
}

// Dead state property state.mode removed
assert(!/mode:\s*'auto'/.test(html.slice(html.indexOf("let state = {"), html.indexOf("let state = {") + 500)),
  "state.mode dead property removed");
assert(!/state\.mode\s*=/.test(html), "state.mode dead write removed");

// Dead functions removed: applyMagCalibrationToHeading
assert(!/applyMagCalibrationToHeading/.test(html), "dead applyMagCalibrationToHeading removed");

// Dead param removed: initRoute bypassExclude
assert(!/'bypassExclude/.test(html) && !/bypassExclude\s*=/.test(html), "dead bypassExclude param removed");

// Dead param removed: handleRouteError existingWaypoints
assert(!/handleRouteError\(e,\s*wps\)/.test(html), "dead existingWaypoints param removed from handleRouteError call");

// Dead branch removed: "24:00" in timestamp formatting
assert(!/"24:00"/.test(html), "dead 24:00 branch removed from timestamp formatting");

// Dead Aero HUD span ID removed
assert(!/id=["']ui-radar-alt["']/.test(html), "dead ui-radar-alt span ID removed");

// Firebase initializeCloudServices called from runApp (was dead — never invoked)
assertIncludes(html, "initializeCloudServices();", "initializeCloudServices called in runApp startup");
assertIncludes(html, "initRoute(wps)", "fuel config save correctly passes waypoints to initRoute");

// Worker dispatch surface (must match worker.js)
assertIncludes(html, "DECODE_VALHALLA", "main thread can request DECODE_VALHALLA");
assertIncludes(html, "CALCULATE_NODES", "main thread can request CALCULATE_NODES");
assertIncludes(html, "PROCESS_OVERPASS", "main thread can request PROCESS_OVERPASS");

// ---------------------------------------------------------------------------
// index.html — weather status observation-override + map rotation unlock
// ---------------------------------------------------------------------------
// Observation override: when Open-Meteo current.weather_code reports an active
// precip code, the dashboard status must say "RAIN NOW" regardless of how
// weakly the ensemble forecast agreement comes out at this hour. Without this
// override the dashboard would display "RAIN POSSIBLE" while it was already
// raining (regression auditors should look here first).
assertIncludes(html, "const WMO_RAIN_CODES = new Set([", "index.html declares WMO_RAIN_CODES active-precip code set");
assertIncludes(html, "const WMO_STATUS = {", "index.html declares granular WMO_STATUS map for at-a-glance detail");
assertIncludes(html, "function getWmoStatus(code, curr)", "index.html gates granular observed status via getWmoStatus with precip gating");
assertIncludes(html, "hasMeasurablePrecip(curr)", "index.html gates drizzle/light-rain RAIN NOW on measurable precip >=0.1 mm");
assertIncludes(html, "if (wmoDetail && wmoDetail.isPrecip) {", "index.html elevates granular precip status above ensemble-forecast tiers");
assertIncludes(html, "\"RAIN NOW\"", "index.html surfaces RAIN NOW status text");
assertIncludes(html, "\"LIGHT DRIZZLE\"", "index.html surfaces granular LIGHT DRIZZLE vs RAIN NOW detail");
assertIncludes(html, "\"NO RAIN\"", "index.html surfaces NO RAIN stable text");

// HEADLINE OVERHAUL (1.10.3): active rain is a four-way OR — the observed
// precip-code verdict can no longer single-handedly veto every richer source.
// During a live convective storm (2026-09-24, proven at the user's pin via live
// API probes) the ECMWF current block said "Overcast, 0.0 mm" while GFS
// reported 1.8 mm and the minutely_15 now-slot 0.20 mm — the card stayed green
// OVERCAST through the whole storm. The headline must listen to the data the
// app already fetches.
assertIncludes(html, "rainByMinutely", "index.html gates headline rain on the minutely_15 now-slot ensemble");
assertIncludes(html, "rainByConsensus", "index.html gates headline rain on multi-model value consensus");
assertIncludes(html, "'RAIN NOW · MODELS'", "index.html labels ensemble-triggered rain source-honestly");
assertIncludes(html, "window.__METEO_CORE_STATE.isRainingNow = !!(data && data.isRainingNow);", "Aero/glance publish uses the consensus verdict, not a code-only recompute");
assertIncludes(html, "const corroborated = rainByMinutelyEff || rainByConsensusEff || (currentAgreement >= 30 && !measuredClear) || rainByRadar || rainByMetar;", "index.html corroboration gate: second independent signal (minutely, consensus, vote, radar, or METAR) — all model-side signals measurement-gated by the tie-break");
assertIncludes(html, "' (POSSIBLE ' + unconfirmedClaim + ')'", "index.html 1.10.5: consensus verdict owns the headline; uncorroborated single-source claims ride as a (POSSIBLE …) parenthetical");
assertIncludes(html, "single-source claim, unconfirmed by ensemble", "index.html desc explains the demoted claim instead of letting the card contradict itself");
assertIncludes(html, "const quorumMet = !lowConfidence || radarClear;", "index.html quorum rule: silence is not a dry vote — demotion requires the authoritative reporting quorum OR a clear radar measurement (a measurement beats a vote)");
assertIncludes(html, "' (UNCONFIRMED)'", "index.html thin-quorum path: the marginal claim keeps the hedged (UNCONFIRMED) amber headline instead of a thin-majority NO RAIN");
// LAYER 2 (1.11.0) — radar ground truth: a measurement outranks every model.
// RainViewer frames+tiles, coverage-mask guard, live-extracted palette, tier-0
// verdict, radar-refutes-marginal-claims.
assertIncludes(html, "fetchRadarSample", "index.html radar point-sample engine present (frames + coverage gate + coordinate tile + pixel decode)");
assertIncludes(html, "const rainByRadar = radarFresh && radarNear && _rd.covered === true && typeof _rd.cls === 'string';", "index.html tier-0 radar trigger: fresh+NEAR covered echo at pin fires RAIN NOW regardless of any model vote (1.14.1: displacement gate added)");
assertIncludes(html, "'RAIN NOW · RADAR'", "index.html radar-triggered headline is source-labelled (measurement, not model consensus)");
assertIncludes(html, "RADAR_CORE_PALETTE", "index.html embeds the live-extracted Universal Blue palette (36 entries, proven against Taipei/Singapore storm tiles 2026-09-25)");
assertIncludes(html, "/v2/coverage/0/256/7/", "index.html radar coverage-mask guard: missing coverage is NOT clear — no-data regions abstain, never vote dry");
assertIncludes(html, "https://api.rainviewer.com", "index.html Layer-2 radar origins present (CONFIG + CSP connect-src)");
assertIncludes(html, "refuted by clear radar", "index.html desc: a clear radar measurement refutes marginal model claims — the 'sunny drizzle' incident resolves by measurement");
// 1.12.0 — two-mode redesign (Drive Mode / Map Mode, user-directed Google-style)
// + zoom-aware rotation + radar map overlay.
assertIncludes(html, "state.tacticalMode = (state.tacticalMode + 1) % 2;", "index.html two-mode cycle: Drive Mode <-> Map Mode (old 3-mode ladder collapsed)");
assertIncludes(html, "const DRIVE_NORTH_Z = 15;", "index.html Drive Mode overview threshold: below z15 the map eases to north-up (the zoomed-out upside-down report)");
assertIncludes(html, "const overviewNorth = state.mapObj.getZoom() < DRIVE_NORTH_Z;", "index.html heading-follow honors the overview threshold — zoomed-out Drive Mode is north-up, never upside-down");
assertIncludes(html, "fa-car-side", "index.html Drive Mode icon (heading-up mode)");
assertIncludes(html, "fa-map text-lg", "index.html Map Mode icon (north-up mode)");
assertIncludes(html, "refreshRadarOverlay", "index.html radar map overlay: RainViewer frames as a Leaflet layer, frame-swapped each refresh");
assertIncludes(html, "radar-overlay-btn", "index.html radar overlay toggle chip present in the map button stack");
assertIncludes(html, "const target = (overviewNorth || state.visual.heading === null) ? 0 : state.visual.heading;", "index.html zoomend re-evaluates Drive Mode rotation immediately — independent of rAF loop liveness (stationary pre-exit)");
assertIncludes(html, "const entryRot = (state.mapObj.getZoom() < DRIVE_NORTH_Z || state.visual.heading === null)", "index.html Drive Mode entry seeds the rotation at once AND honors the overview threshold (no-coords path)");
// 1.13.0 — per-route-node radar: WET NOW per node via tile-batch sampling.
assertIncludes(html, "async function fetchRadarRouteSample(nodes)", "index.html route radar sampler: one decoded tile batch covers a whole route (spatial radar, not 99 point calls)");
assertIncludes(html, "const isWetNowByRadar = !!(_nodeRadar && _nodeRadar.cls);", "index.html per-node tier-0: a radar echo at a node outranks the model vote");
assertIncludes(html, "'WET NOW · RADAR'", "index.html radar-wet nodes are source-labelled with intensity (measurement, not model consensus)");
assertIncludes(html, "routeNodesRadarSummary = {", "index.html publishes the route-radar diagnostic summary to CORE_STATE (nodes sampled + wet count)");
// 1.13.0 — METAR ground truth via the user's Cloudflare Worker proxy
// (aviationweather.gov is CORS-blocked; /metar route deployed 2026-09-25, verified live).
assertIncludes(html, "async function fetchMetarObs(lat, lon)", "index.html METAR fetch helper: nearest station from the live-proven table, via the proxy origin already in CSP");
assertIncludes(html, "const rainByMetar = metarFresh && _mt.wet === true;", "index.html METAR wet-side corroborator: a station reporting precip corroborates rain; a clear station NEVER refutes (displacement honesty)");
assertIncludes(html, "METAR_STATIONS", "index.html embeds the live-proven PH station table (coords verified against the API 2026-09-25)");
assertIncludes(html, "`${CONFIG.edgeProxy}/metar?ids=${best.id}`", "index.html METAR rides the existing proxy origin — zero CSP changes");
// 1.13.0 pre-release fixes: the models-vs-measurements tie-break + Drive Mode zoom re-center.
assertIncludes(html, "const measuredClear = radarClear && metarFresh && !rainByMetar;", "index.html tie-break: BOTH fresh measurements reading clear suppress model-side rain triggers (the sunny RAIN NOW · MODELS report)");
assertIncludes(html, "const rainByMinutelyEff = rainByMinutely && !measuredClear;", "index.html ensemble triggers are measurement-gated — a clear radar + clear METAR refutes the nowcast/consensus claims");
assertIncludes(html, "'models claim rain — measurements clear'", "index.html suppressed model claims stay visible in the desc — the card never hides WHY");
assertIncludes(html, "state.mapObj.panTo([clat, clon], { animate: false, duration: 0 });", "index.html Drive Mode re-centers on the user after every zoom (Leaflet zooms around the gesture point — the drift report)");
// 1.13.2 — four-agent audit round: radar sampler window, recenter chain, METAR
// freshness recompute, offline restore ordering, payloadSig fingerprint.
assertIncludes(html, "for (let i = 0; i < 36; i += 4)", "index.html radar window scans ALL 9 pixels — the i<12 loop read only the top row (sample offset ~1.2km north of the pin)");
assertIncludes(html, "const metarFresh = !!(_mt && typeof _mt.obsTime === 'number' &&", "index.html METAR freshness recomputed at verdict time from obsTime — the fetch-time snapshot is never trusted");
assertIncludes(html, "(wmoDetail.isTrace === true && !measuredClear)", "index.html TRACE claims no longer set isRainingNow against both clear measurements");
assertIncludes(html, "commitRouteRadarSample", "index.html route samples commit through the shared gate (route identity + frame version — no clobber races, no redundant re-downloads)");
assertIncludes(html, "String(window.__METEO_CORE_STATE.radarNow?.frameTime ?? '') + '|' +", "index.html payloadSig carries the measurement fingerprint — verdict flips re-evaluate, not pinned for 15 min");
assertIncludes(html, "window.recenterNow = function()", "index.html recenter NOW button runs a real function — the old inline handler referenced module-scoped state and threw ReferenceError");
assertIncludes(html, "function relockDriveMode()", "index.html re-lock preserves the driver's pinch-chosen zoom (no mode-entry setView(z17) snap on recenter)");
assertIncludes(html, "const showRecenter = !state.isMapLocked && state.tacticalMode > 0 && state.autoCoords && state._recenterDeadline;", "index.html 1.14.1 (revised from the 1.13.2 route-term guard): recenter chip is DEADLINE-driven — it shows exactly when a relock is armed (route or not), so no auto-relock is ever silent; Map Mode never arms one so the chip can never reappear there");

// Map rotation is heading-driven only: dragging/panning the map must NOT cause
// any rotation change. The map stays at whatever heading rotation it currently
// has throughout the drag (no rotate(0deg) reset, no hud-rotating smear). The
// heading-follow drive in smoothVisualsLoop is gated behind state.isMapLocked,
// so during a drag (isMapLocked=false) it is dormant — only real heading changes
// rotate the map, never the pan gesture. lastCssHeading is cleared on dragstart
// so the post-drag re-seed reads the live visual heading cleanly.
assertIncludes(html, "#hud-map.hud-rotating", "index.html defines .hud-rotating transition CSS (retained for future use / module-toggle path)");
assertIncludes(html, "// Dragging must NOT rotate the map.", "index.html documents that drag must not rotate the map (heading-only rotation contract)");
assertIncludes(html, "state.lastCssHeading = null;", "index.html clears lastCssHeading on dragstart to let the heading-follow loop re-seed cleanly after drag");

// Rotated-frame drag compensation: when the map is CSS-rotated by rotate(-heading)
// under tactical mode, Leaflet's Draggable applies finger deltas (dx, dy) verbatim
// so the on-screen motion becomes R_css(-h) * (dx, dy) — i.e. rotated away from the
// finger direction. A predrag hook rotates _newPos around _startPos by +heading so
// the parent rotation cancels and the on-screen motion equals the finger delta.
// Rotation remains heading-only (the hook touches the pan delta, never the rotation
// transform). No-op when tacticalMode<1 or heading is null/0 (north-up).
assertIncludes(html, "_panRotateHookInstalled", "index.html guards one-shot install of the rotated-drag predrag hook");
assertIncludes(html, "predrag', (e) => {", "index.html hooks Draggable's predrag event to compensate for the parent's CSS rotation");
assertIncludes(html, "d._newPos.x = d._startPos.x + (dx * cos - dy * sin);", "index.html rotates pan delta by +heading before Leaflet applies setPosition");
assertIncludes(html, "d._newPos.y = d._startPos.y + (dx * sin + dy * cos);", "index.html completes the 2D rotation of the pan delta (y component)");

// Route timeline nodes: observed weather_code must drive wetness status, not
// the ensemble forecast vote — same granular override as the dashboard applies.
assertIncludes(html, "getWmoStatus(code,", "index.html route nodes derive granular status via getWmoStatus");
assertIncludes(html, "(isRainingNowNode || isWetNowByRadar) ? 'RAIN_NOW' : WeatherEnsemble.classifyWetness(stats.wetPct)", "index.html route nodes elevate to RAIN_NOW on observed precip OR a radar echo at the node (tier-0 measurement)");
assertIncludes(html, "status === 'RAIN_NOW'", "index.html route node path icon/color distinguishes RAIN_NOW tier");

// Aero-Vector HUD: surface the observed current.weather_code (and active-rain
// boolean) to the Aero HUD's __METEO_CORE_STATE consumer, plus a weather chip
// rendered below the HUD title that uses the observed code — not the ensemble
// agreement forecast vote.
assertIncludes(html, "__METEO_CORE_STATE.weatherCode = dCurr.current.weather_code", "index.html surfaces observed weather_code to Aero HUD");
assertIncludes(html, "getWmoStatus(window.__METEO_CORE_STATE.weatherCode,", "index.html precomputes granular isRainingNow via getWmoStatus for the Aero HUD hot path");
assertIncludes(html, "id=\"ui-radar-wxm-icon\"", "index.html declares Aero HUD weather-icon element");
assertIncludes(html, "id=\"ui-radar-wxm-text\"", "index.html declares Aero HUD weather-text element");

// Aero HUD mount anchor: the HUD card must mount into the explicit #main-grid
// layout container. The previous class heuristic (first .grid with grid-cols-*
// + gap) matched the Pit Stop modal's "grid grid-cols-2 gap-2" Fuels row — the
// last matching element in document order — and silently mounted the card
// inside the hidden #fuel-settings-modal (display:none keeps it in the DOM, so
// querySelectorAll found it). These guards pin the anchor + forbid the
// heuristic from returning.
assertIncludes(html, "id=\"main-grid\"", "index.html declares the explicit #main-grid layout anchor for the Aero HUD card");
assertIncludes(html, "document.getElementById('main-grid')", "index.html mounts the Aero HUD card into #main-grid by ID (no class heuristic)");
assert(!/querySelectorAll\('\.grid'\)/.test(html), "Aero HUD class-heuristic grid discovery removed (was mounting into the hidden Pit Stop modal)");
assertIncludes(html, "closest('.hidden')", "index.html guards the Aero HUD mount target against hidden ancestors (loud warn instead of silent modal mount)");

// Aero mobile-fullscreen: rails dock below the dial on narrow viewports,
// dial fit is layout-honest (bleed margins), expand button is 48px
assertIncludes(html, "aero-radar-card", "index.html ids the Aero radar card for fullscreen-mobile CSS");
assertIncludes(html, 'id="aero-row-top"', "index.html groups Aero fullscreen chips into top corners around the centered dial");
assertIncludes(html, 'id="aero-row-bottom"', "index.html groups Aero fullscreen chips into bottom corners around the centered dial");
assertIncludes(html, 'id="aero-corner-br"', "index.html balances 8 chips as 4 corners x 2 (Rain + Sun bottom-right)");
assertIncludes(html, 'id="ui-radar-sun-a"', "index.html declares the 8th Sun chip (upcoming rise/set)");
assertIncludes(html, "daily=sunrise,sunset", "index.html fetches daily sunrise/sunset for the Sun chip");
assertIncludes(html, "nextSunPair", "index.html computes the upcoming rise/set pair for the Sun chip");
assertIncludes(html, "fitAeroDial", "index.html fits the Aero dial to the viewport with bleed compensation + resize re-fit");
assertIncludes(html, 'id="aero-dial-stage"', "index.html centres the Aero dial in a flex-1 stage with corner rows pinned top/bottom");
assertIncludes(html, 'id="ui-tape-hdg-strip"', "index.html renders a digital heading tape above the compass");
assertIncludes(html, 'id="aero-tape-spd"', "index.html renders a left vertical speed tape");
assertIncludes(html, 'id="aero-tape-alt"', "index.html renders a right vertical altitude tape");
assertIncludes(html, "buildTapeTicks", "index.html builds tape ticks once at mount (no per-frame allocation)");
assertIncludes(html, "SPD_KMH", "speed tape keeps a km/h domain (knots shortens its own)");
assertIncludes(html, "SPD_KT", "speed tape rebuilds in knots with a centred dead-0");
assertIncludes(html, "bearingTo(lat1, lon1, lat2, lon2)", "COG steering has a great-circle bearing helper");
assertIncludes(html, "crossTrackKm", "COG steering has a signed cross-track helper");
assertIncludes(html, 'id="ui-tape-spd-box"', "knots toggle lives on the speed-tape readout box");
assertIncludes(html, 'id="ui-tape-steer"', "heading band renders the waypoint steering line (hidden when idle)");
assertIncludes(html, 'id="ui-radar-temp"', "Temp corner chip replaces Regime");
assertIncludes(html, 'id="ui-radar-winddir"', "Wind corner chip replaces Spread");
assertIncludes(html, 'id="ui-radar-rain"', "Rain corner chip replaces Brier");
assert(
  !html.includes('id="ui-radar-regime"') && !html.includes('id="ui-radar-spread"') && !html.includes('id="ui-radar-brier"') && !html.includes('NO ROUTE'),
  "retired Regime/Spread/Brier chips + NO ROUTE placeholder fully removed"
);
assertIncludes(html, "computeRainEta", "rain countdown derives from minutely_15 at fetch cadence");
assertIncludes(html, "tape-neg", "sub-zero speed ticks are tinted as dead zone");
assertIncludes(html, ".tape-strip { position: absolute; top: 0; left: 0; width: 100%;", "tape strips span their window so right-anchored alt ticks resolve inside it (zero-width strip clipped them)");
assertIncludes(html, 'text-brand-red font-black bg-surface-900 px-1 rounded border border-surface-700">N', "compass North badge renders red");
assertIncludes(html, "v % 50 === 0", "altitude tape labels every 50 m (speed-density parity)");
assertIncludes(html, "width:44px;height:180px", "vertical tapes scaled to heading-tape presence (44x180 windows)");
assertIncludes(html, "if (jAQ || jMar)", "sibling TTL stamps only on partial success (total failure retries next tick)");
assertIncludes(html, "_depTries", "boot dependency wait is bounded with an honest terminal state");
assertIncludes(html, "__METEO_CORE_STATE.groundSpeed", "index.html publishes smoothed ground speed for the speed tape");
assert(
  !html.includes('id="ui-radar-crosswind"') && !html.includes('id="ui-radar-headwind"'),
  "retired CRS/TAL crosswind chips fully removed (wind readout lives inside the compass now)"
);
assert(
  !html.includes('id="ui-radar-alt-container"') && !html.includes('id="ui-radar-rel-angle"'),
  "retired header altimeter + bottom rel-angle readouts fully removed (tapes own that data now)"
);
assertIncludes(html, "aero-chip", "index.html pins Aero chip geometry in real CSS (immune to stale Tailwind builds)");
assertIncludes(html, 'id="ui-radar-dewpoint"', "index.html enriches the humidity chip with a Magnus dew-point sub-line");
assertIncludes(html, 'id="radar-expand-btn" class="tap-48', "Aero expand button meets the 48px driving touch target");

// Telemetry chart hour-strip: ALL THREE of (1) local-hour conversion from UTC
// unix seconds, (2) Today/Tomorrow day label row via tick callback, (3) raw
// unix-second sidecar on state.chart so the callback can recover the actual
// local date bucket per tick. Without (1) the chart showed UTC hours while
// the user's wall clock showed local — the "23:00 at 6:47 AM" confusion.
assertIncludes(html, "if (typeof dCurr.utc_offset_seconds === 'number') state.utcOffsetSec = dCurr.utc_offset_seconds;", "index.html caches Open-Meteo utc_offset_seconds for local-hour decoding");
assertIncludes(html, "function fmtHour(unixSec, utcOffsetSec = 0)", "index.html hoisted fmtHour function for local-hour formatting");
assertIncludes(html, "fmtHour(t, utcOffsetSec)", "index.html chart hour-label uses local time (UTC+offset) via hoisted fmtHour");
assertIncludes(html, "timesUnix[i] = t;", "index.html thread raw unix timestamps through to chart for day-label computation");
assertIncludes(html, "state.chart.timesUnixRef = timesUnix", "index.html stores raw unix timestamps on chart for tick callback");
assertIncludes(html, "callback: function(value, index)", "index.html x-axis uses custom tick callback for day labels");
assertIncludes(html, "'TODAY'", "index.html x-axis callback can emit TODAY day label");
assertIncludes(html, "'TOMORROW'", "index.html x-axis callback can emit TOMORROW day label");
assertIncludes(html, "'YESTERDAY'", "index.html x-axis callback covers cache-stale data spanning a previous-day fetch");

// Null-safety + closure hoist audit fix checks.
assertIncludes(html, "&& DOM.secIntel)", "index.html DOM.secIntel access is null-guarded");
assertIncludes(html, "magCalState._countEl = document.getElementById('magcal-count')", "index.html caches magcal-count DOM element once instead of getElementById at 60Hz");
assertIncludes(html, "try { await wakeLock.release(); } catch (e)", "index.html wakeLock release is try-catch guarded");

// Weather station fields (since 1.3.1): precipitation intensity, pressure, visibility
assertIncludes(html, "current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,precipitation,rain,showers,snowfall,cloud_cover,pressure_msl,visibility,wind_speed_10m", "index.html main telemetry fetch requests precipitation, precip-breakdown, pressure, visibility");
assertIncludes(html, "__METEO_CORE_STATE.visibility = dCurr.current.visibility", "index.html publishes visibility to Aero HUD state");
assertIncludes(html, "__METEO_CORE_STATE.pressure   = dCurr.current.pressure", "index.html publishes pressure to Aero HUD state");
assertIncludes(html, "id=\"metric-pressure\"", "index.html declares telemetry-card pressure element");
assertIncludes(html, "id=\"metric-visibility\"", "index.html declares telemetry-card visibility element");
assertIncludes(html, "id=\"ui-radar-visibility\"", "index.html declares Aero HUD visibility element");

// Full weather station profile: rain, showers, snowfall, cloud_cover are
// now requested AND displayed in telemetry card + Aero HUD.
assertIncludes(html, "precipBreakdown: {", "index.html assembles precipBreakdown struct in normalizeTelemetryData");
assertIncludes(html, "rain:    (dCurr && dCurr.current && typeof dCurr.current.rain", "index.html propagates rain (frontal) precip");
assertIncludes(html, "showers: (dCurr && dCurr.current && typeof dCurr.current.showers", "index.html propagates showers (convective) precip");
assertIncludes(html, "snowfall:(dCurr && dCurr.current && typeof dCurr.current.snowfall", "index.html propagates snowfall");
assertIncludes(html, "cloudCover: (dCurr && dCurr.current && typeof dCurr.current.cloud_cover", "index.html propagates cloud cover");
assertIncludes(html, "const ccover  = (typeof cloudCover === 'number')", "index.html telemetry card reads cloud cover for human label");

// Solar/UV non-negative guard: Open-Meteo emits occasional negative
// shortwave_radiation (e.g. -1.5 at 01:00); without Math.max(0, …) it dragged
// y_solar below zero and Chart.js drew a "-200" tick.
assertIncludes(html, "Math.max(0, so)", "index.html clamps solar to non-negative (kills -200 tick class)");
assertIncludes(html, "suggestedMin: 0, suggestedMax: 1000", "index.html floors y_solar at 0");

// ---------------------------------------------------------------------------
// worker.js — task dispatcher integrity
// ---------------------------------------------------------------------------
const workerSrc = readFileSync(join(repoRoot, "worker.js"), "utf8");
for (const type of ["DECODE_VALHALLA", "CALCULATE_NODES", "PROCESS_OVERPASS"]) {
  assertIncludes(workerSrc, `case '${type}'`, `worker.js handles ${type}`);
}
assertIncludes(workerSrc, "self.onmessage", "worker.js listens for messages");
assertIncludes(workerSrc, "self.postMessage", "worker.js posts results back");
assertIncludes(workerSrc, "exactInTopK", "worker.js uses Top-K-scoped exact match count");
assertIncludes(workerSrc, "exactInTopK > 0", "worker.js strict filter gates on Top-K exact count");

// ---------------------------------------------------------------------------
// sw.js — cache-strategy integrity
// ---------------------------------------------------------------------------
const swSrc = readFileSync(join(repoRoot, "sw.js"), "utf8");
assertIncludes(swSrc, "self.addEventListener('install'", "sw.js install hook");
assertIncludes(swSrc, "self.addEventListener('activate'", "sw.js activate hook");
assertIncludes(swSrc, "self.addEventListener('fetch'", "sw.js fetch hook");
assertIncludes(swSrc, "APP_CACHE", "sw.js defines APP_CACHE");
assertIncludes(swSrc, "tile.openstreetmap.org", "sw.js caches map tiles");
assertIncludes(swSrc, "_mapCacheBytes", "sw.js has MAP_CACHE in-memory byte tracking");
assertIncludes(swSrc, "evictOldestTiles", "sw.js has MAP_CACHE LRU eviction");
assertIncludes(swSrc, "./tailwind.min.css", "sw.js STATIC_ASSETS includes tailwind.min.css");
assertIncludes(swSrc, "fa-solid-900.woff2", "sw.js CDN_PRECACHE includes Font Awesome woff2 fonts");
assert(!/self\.skipWaiting/.test(swSrc.slice(swSrc.indexOf("self.addEventListener('install'"), swSrc.indexOf("self.addEventListener('activate'"))),
  "sw.js install hook no longer calls skipWaiting() (deferred to SKIP_WAITING message)");
assertIncludes(swSrc, "SKIP_WAITING", "sw.js handles SKIP_WAITING message for controlled activation");

// ---------------------------------------------------------------------------
// manifest.json — valid JSON + required PWA fields
// ---------------------------------------------------------------------------
const manifestRaw = readFileSync(join(repoRoot, "manifest.json"), "utf8");
let manifest;
try {
  manifest = JSON.parse(manifestRaw);
  assert(true, "manifest.json parses as JSON");
} catch (err) {
  assert(false, "manifest.json parses as JSON — " + err.message);
}
if (manifest) {
  assert(typeof manifest.name === "string" && manifest.name.length > 0, "manifest.name present");
  assert(typeof manifest.short_name === "string" && manifest.short_name.length > 0, "manifest.short_name present");
  assert(manifest.start_url, "manifest.start_url present");
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest.icons present");
  assert(manifest.display === "standalone", "manifest.display is standalone");
  assert(manifest.orientation === "any" || !manifest.orientation, "manifest.orientation is 'any' or omitted");
  // manifest icons must be local files (no Flaticon CDN dependency)
  const iconSrcs = manifest.icons.map(i => i.src);
  assert(
    iconSrcs.every(s => s.startsWith("./")),
    "manifest icons are local files (no Flaticon CDN dependency)"
  );
  assert(iconSrcs.some(s => s.endsWith("192.png")), "manifest has a 192x192 icon");
  assert(iconSrcs.some(s => s.endsWith("512.png")), "manifest has a 512x512 icon");
}

// ---------------------------------------------------------------------------
// 1.14.0 stable drive rotation + purge immediate feedback + verdict basis
// ---------------------------------------------------------------------------
assertIncludes(html, "mapHeading: null, _prevCog: null", "index.html 1.14.0: mapHeading is the rotation authority (GNSS COG at speed, freeze below gate), null until a stable source speaks");
assertIncludes(html, "DRIVE_ROT_MIN_KMH = 8", "index.html 1.14.0: COG accepted only at/above 8 km/h — below the gate the rotation freezes (a stop light must not rotate the map)");
assertIncludes(html, "MAP_ROT_MAX_DEG_S = 30", "index.html 1.14.0: rotation rate cap — planted feel; one noisy COG fix moves the map ~0.5° before the next fix corrects it");
assertIncludes(html, "state.mapHeading !== null ? state.mapHeading : state.cumulativeHeading", "index.html 1.14.0: rotation target prefers mapHeading, falls back to cumulativeHeading (1.13.x boot parity)");
assertIncludes(html, "timeConstant = moving ? 600 : 250", "index.html 1.14.0: planted-feel lerp tc — slow tail + hard rate cap (fluidity G1 rate-cap contract, pinned so it cannot silently change)");
assertIncludes(html, "maxStepD / Math.abs(dHeading)", "index.html 1.14.0: the rate cap actually applies — the exp lerp alpha shrinks when the step would exceed the cap");
assertIncludes(html, "_arrowFrozen", "index.html 1.14.0: position arrow freezes while a Drive Mode drag holds the map unlocked (a live arrow on a frozen map reads sideways)");
assertIncludes(html, "offsetConfidence >= 0.5", "index.html 1.14.0: below driving speed only a CONVERGED calibrated magnetometer may rotate the map — uncalibrated mag in a car frame is tens of degrees off");
assertIncludes(html, "permState === 'prompt'", "index.html 1.14.0: purge re-asks GPS only when the browser permission is still prompt — granted/denied skip the dead wait");
assertIncludes(html, "PURGING LOCAL DATA — THE APP WILL RESTART SHORTLY.", "index.html 1.14.0: purge modal flips to a progress state on the same tick as the tap — no silent dead-feeling button");
assertIncludes(html, 'id="focus-verdict-basis"', "index.html 1.14.0: verdict-basis block exists in the focus-only analysis surface");
assertIncludes(html, "focusVerdictBasis: document.getElementById('focus-verdict-basis')", "index.html 1.14.0: verdict-basis element is cached in the DOM map (no per-render getElementById)");
assertIncludes(html, "Trigger ${wmoDetail.label} — ${rainSourcesNote}", "index.html 1.14.0: verdict-basis writer names which source triggered the headline (the analysis surface answers 'why does the headline say that')");

// ---------------------------------------------------------------------------
// 1.14.1 — four-agent bug-hunt round: rotation wrap, mag dead zone, radar
// displacement + basis freshness, minutely offline ordering, body-read
// budgets, SW tile eviction order, purge/prefetch/update-pill races.
// Every guard below pins a line this round ADDED or consciously revised.
// ---------------------------------------------------------------------------
// Rotation wrap (HIGH, dual-agent convergence): true modulo normalization.
assertIncludes(html, "let dHeading = ((_rotTarget - state.visual.heading) % 360 + 540) % 360 - 180;", "index.html 1.14.1: follow-block delta is modulo-normalized — the old single ±360 correction let a >540° accumulator offset cartwheel the map on the first COG accept");
assertIncludes(html, "Math.abs(((_rotTarget - state.visual.heading) % 360 + 540) % 360 - 180) <= 0.5", "index.html 1.14.1: stationary pre-exit compares wrap-safe — the raw |target-visual| never re-fired after one north-seam crossing (60fps frames while parked)");
// Mag fallback: below the COG gate ONLY (dead zone + speed-freeze).
assertIncludes(html, "state.currentSpeed < DRIVE_ROT_MIN_KMH && state.sensorHeading !== null &&", "index.html 1.14.1: calibrated-mag rotation fallback is speed-gated below the COG gate — closes the 2-8 km/h dead zone AND freezes the map when COG drops out at driving speed");
// zoomend rotation write is lock-gated (the panTo below it always was).
assertIncludes(html, "if (state.isMapLocked && targetR !== state.lastCssHeading) {", "index.html 1.14.1: zoomend rotation write is lock-gated — a pinch during the unlocked Drive Mode browse window must not snap the map to the live heading under the user's fingers");
// Unlocked-toggle in Drive Mode re-locks through relockDriveMode (zoom preserved).
assertIncludes(html, "if (state.tacticalMode > 0) { relockDriveMode(); return; }", "index.html 1.14.1: tapping the mode button while drag-unlocked in Drive Mode re-locks WITHOUT the mode-entry setView(z17) zoom snap (the 1.13.2 contract, now honored on the third path too)");
// Radar displacement gate (verdict + sample shape).
assertIncludes(html, "fastDistance(state._verdictLat, state._verdictLon, _rd.lat, _rd.lon) <= 5000", "index.html 1.14.1: radar votes are DISPLACEMENT-gated — a fresh-by-age sample taken ~25 km behind the driver must not fire the measuredClear tie-break on this pin");
assertIncludes(html, "covered: false, cls: null, mmh: null, frameTime: frame.time, ts: Date.now(), lat, lon", "index.html 1.14.1: radar samples carry their position — the displacement gate has the data to reject displaced restores");
// Basis radar line freshness + honest stale abstention.
assertIncludes(html, "'Radar stale — abstained'", "index.html 1.14.1: verdict-basis radar line is freshness+displacement gated — a stale restored sample must not print 'Radar clear' under a RAIN NOW headline (it can only abstain, honestly)");
// METAR distance recomputed at verdict time.
assertIncludes(html, "let _mtDistKm = _mt ? _mt.distKm : null;", "index.html 1.14.1: METAR note distance recomputed at verdict time — the stored fetch-time distKm said '36km' after the user drove 100 km");
// Body-read budgets (headers-then-stall cannot hang the single-flight latch).
assertIncludes(html, "async function readBodyOrNull(res, ms, reader)", "index.html 1.14.1: body-read budget helper exists — fetch resolves at headers; a stalled body inside the fetch latch froze ALL telemetry");
assertIncludes(html, "return await readBodyOrNull(r, timeoutMs + 3000, x => x.json());", "index.html 1.14.1: sibling JSON body reads are raced (AQ/marine sit inside the fetch latch)");
assertIncludes(html, "await readBodyOrNull(r, 8000, x => x.blob());", "index.html 1.14.1: radar tile body reads are raced (coverage + pin sample)");
assertIncludes(html, "const dAll = await rAll.json();", "index.html 1.14.1: weather bundle body read still present (budget timer now cleared AFTER it)");
// Minutely restored BEFORE the offline/denied render (order-guarded).
assert(
  html.indexOf("1.14.1: minutely restored BEFORE the render") >= 0 &&
  html.indexOf("1.14.1: minutely restored BEFORE the render") < html.indexOf("await processTelemetryPayload(cached.dCurr, cached.dFore, cached.dSolar, true, cached.timestamp, cached.dDaily);"),
  "index.html 1.14.1: denied-path minutely restore precedes its render (rainByMinutely is verdict input)"
);
assert(
  html.lastIndexOf("1.14.1: restore MINUTELY before the render") >= 0 &&
  html.lastIndexOf("1.14.1: restore MINUTELY before the render") < html.lastIndexOf("await processTelemetryPayload(cached.dCurr"),
  "index.html 1.14.1: offline-path minutely restore precedes its render (the sig carries no minutely field — restore-after-render pinned the omission until an hour roll)"
);
// Sibling backfill age guard (the ≤10-min the comment always claimed).
assertIncludes(html, "(now - cMar.timestamp) <= 600000 ? cMar.dMarine : null", "index.html 1.14.1: marine backfill is age-gated ≤10 min — an unguarded 46h-old row rendered its 47h-ahead tail cell as CURRENT sea state");
assertIncludes(html, "(now - cAQ.timestamp) <= 600000 ? cAQ.dAQ : null", "index.html 1.14.1: AQ backfill is age-gated ≤10 min (same class as marine)");
// computeRainEta floor semantics (agree with the verdict slot search).
assertIncludes(html, "Math.max(0, Math.floor((Date.now() - t0) / 900000))", "index.html 1.14.1: rain-countdown cell offset uses floor — Math.round skipped the half-elapsed current cell and overstated time-to-rain by up to 7.5 min");
// payloadSig measurement AGE buckets (freshness crossings re-render).
assertIncludes(html, "Math.floor((Date.now() - window.__METEO_CORE_STATE.radarNow.frameTime * 1000) / 900000)", "index.html 1.14.1: payloadSig carries radar frame AGE buckets — a dead radar origin crossing the 15-min freshness bound re-renders instead of pinning the stale verdict");
// Render-throw must not stamp the freshness gate.
assertIncludes(html, "if (!_renderFailed) state.telemetryCache.timestamp = now;", "index.html 1.14.1: telemetry freshness stamp only on a landed render — a caught render throw previously suppressed the next fetch for a full cacheTTL");
// Aborted route-node compute is not a failure.
assertIncludes(html, "an ABORTED compute is not a failure", "index.html 1.14.1: the CALCULATE_NODES catch returns on abort — a pitstop/destination swap mid-compute previously clobbered routeNodes=[] and blinked every node marker");
// Elevation route-identity gate (the commitRouteRadarSample pattern).
assertIncludes(html, "if (state.routeNodes !== nodes) return;", "index.html 1.14.1: elevation commit is route-identity gated — a hung old-route fetch can no longer overwrite the new route's profile + sig");
// Purge: debounce clear + watchdog.
assertIncludes(html, "if (state._prefetchDebounce) { clearTimeout(state._prefetchDebounce); state._prefetchDebounce = null; }", "index.html 1.14.1: purge clears the tracked prefetch debounce — an armed 5s timer inside the purge window re-landed tiles after caches.delete");
assertIncludes(html, "await Promise.race([_wipeOps, new Promise(resolve => setTimeout(resolve, 10000))]);", "index.html 1.14.1: purge wipe is watchdog-raced (10s) — a hung IDB/cache await can no longer park the modal disabled forever");
// Update pill: the rejection path evicts the shell too.
assertIncludes(html, "swReg.update().catch(() => { clearTimeout(_fb); void _evictShellThenReload(); });", "index.html 1.14.1: update-pill rejection runs the same evict-then-reload as the 15s fallback — a bare reload on a flaky sw.js fetch silently never applied the update");
// GPS one-shot accuracy gate + unconditional recovery re-arm (the re-arm
// itself is pinned by the revised legacy guard above).
assertIncludes(html, "if (p.coords.accuracy > 3000) { done(null); return; }", "index.html 1.14.1: requestGpsFixOnce enforces the >3000 m gate boot/watch already had — the recovery consumer fed an 8 km WiFi fix into initMap+fetchData");
// Recenter outer timer self-null hygiene.
assertIncludes(html, "self-null on fire (hygiene", "index.html 1.14.1: the 5s recenter timer self-nulls on fire (the inner 600ms timer always did)");
// Verdict-coord scratch pre-declared.
assertIncludes(html, "_verdictLat: null, _verdictLon: null,", "index.html 1.14.1: verdict-coord scratch fields pre-declared in the state literal (hidden-class doctrine)");

// sw.js — release-gate bump + tile eviction order (swSrc declared at line 543).
assertIncludes(swSrc, "const APP_CACHE = 'meteonexus-app-v20'", "sw.js APP_CACHE v20 — 1.14.1 release gate step 6 (the SW update detector must fire or installed clients never fetch the new shell)");
assertIncludes(swSrc, "keys.sort((a, b) => zoomOf(a) - zoomOf(b));", "sw.js 1.14.1: tile eviction sorts by NUMERIC zoom (coarse first) — the string sort evicted the z14-17 driving tiles before the coarse overviews, eating freshly prefetched route corridors");

// ---------------------------------------------------------------------------
// MCP tooling doctrine retention (AGENTS.md §12 + opencode.json mcp block)
// User directive 2026-09-27: the doctrine table is source of truth and must
// survive every session, at all cost. Every package was npm-viewed AND
// test-launched (MCP initialize handshake) before wiring — no hallucinated
// servers. These guards make silent deletion loud (the state.lastCssHeading
// precedent applied to session tooling).
// 2026-10-04 amendment: plane doctrine (Knowledge: Standard/Technique
// Reference, Quality: QA/compliance — data-plane BANNED). geoapify RETIRED;
// its absence from opencode.json is enforced by a negative guard below
// (2 guards consciously retargeted per §1.6).
// ---------------------------------------------------------------------------
const agentsMd = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
assertIncludes(agentsMd, "## 12. MCP tooling doctrine", "AGENTS.md declares the §12 MCP doctrine header (binding source of truth in every session)");
assertIncludes(agentsMd, "@upstash/context7-mcp", "§12 pins context7 (live library docs: MapLibre, Leaflet, vis.gl, geomagnetism — stops hallucinated APIs)");
assertIncludes(agentsMd, "@shuji-bonji/w3c-mcp", "§12 pins w3c (Service Worker, Web App Manifest, Sensor / Device Orientation via webref)");
assertIncludes(agentsMd, "@danielsogl/lighthouse-mcp", "§12 pins lighthouse (PWA audit: installability, HTTPS, SW — not sensors)");
assertIncludes(agentsMd, "chrome-devtools-mcp", "§12 pins chrome-devtools (device QA: GPS emulation, sensors, Permissions-Policy)");
assertIncludes(agentsMd, "@cyanheads/openstreetmap-mcp-server", "§12 pins openstreetmap (tiles/routing backend: Nominatim + Overpass)");
assertIncludes(agentsMd, "RETIRED 2026-10-04", "§12 records the geoapify retirement (data-plane class — the 2026-10-04 plane doctrine)");
assertIncludes(agentsMd, "Do not put compass on a server", "§12 keeps the boundary rule: compass/heading never goes through an MCP server");
assertIncludes(agentsMd, "No data-plane MCP", "§12 pins the 2026-10-04 data-plane ban (weather/Open-Meteo/METAR wrappers duplicate the app's keyless fetches — ground-truth probes use raw fetch + chrome-devtools)");
assertIncludes(agentsMd, "Standard Reference", "§12 pins the knowledge plane — Standard Reference (W3C/webref spec truth)");
assertIncludes(agentsMd, "Technique Reference", "§12 pins the knowledge plane — Technique Reference (Context7 library docs)");
assertIncludes(agentsMd, "user-scope ground-truth verification", "§12 records osrm as the user-scope ground-truth verification instrument (live-proven 2026-10-04, real 13.2 km Manila route)");

const opencodeJsonRaw = readFileSync(join(repoRoot, "opencode.json"), "utf8");
let opencodeCfg;
try {
  opencodeCfg = JSON.parse(opencodeJsonRaw);
  assert(true, "opencode.json parses as JSON");
} catch (err) {
  assert(false, "opencode.json parses as JSON — " + err.message);
}
if (opencodeCfg && opencodeCfg.mcp) {
  for (const key of ["playwright", "github", "chrome-devtools", "context7", "w3c", "lighthouse", "openstreetmap"]) {
    assert(Object.prototype.hasOwnProperty.call(opencodeCfg.mcp, key), `opencode.json mcp block has '${key}'`);
  }
  const doctrineServers = {
    context7: "@upstash/context7-mcp",
    w3c: "@shuji-bonji/w3c-mcp",
    lighthouse: "@danielsogl/lighthouse-mcp",
    openstreetmap: "@cyanheads/openstreetmap-mcp-server"
  };
  for (const [key, pkg] of Object.entries(doctrineServers)) {
    const srv = opencodeCfg.mcp[key];
    assert(!!srv && srv.enabled === true, `opencode.json mcp '${key}' is enabled`);
    assert(!!srv && Array.isArray(srv.command) && srv.command.join(" ").includes(pkg), `opencode.json mcp '${key}' launches ${pkg}`);
  }
} else {
  assert(false, "opencode.json has an mcp block");
}
assert(!opencodeJsonRaw.includes("@pipeworx/mcp-geoapify"), "opencode.json no longer wires geoapify (RETIRED 2026-10-04, data-plane class) — negative retention guard");

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log("");
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("");
  console.error("FAILED ASSERTIONS:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("  sanity OK");
process.exit(0);
