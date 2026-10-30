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
assertIncludes(html, "grid-cols-6", "map toolbar lays buttons in an even portrait grid (search takes its own full row) — 1.16.7 consciously REVISED per §1.6: grid-cols-5 → grid-cols-6 so the Nav button un-hiding mid-drive fills column 6 instead of wrapping the cluster to a third row");
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
assertIncludes(html, "text-base md:text-sm font-bold text-white placeholder-gray-400", "search input stays 16px on mobile (no iOS focus zoom; 1.16.5 consciously revised per §1.6: placeholder-gray-500 was the one gray-500 the 1.15.0 contrast sweep couldn't see — ~3.6:1 on surface-800, exempt from axe but below the project's own gray-400 standard)");
assertIncludes(html, "flex flex-wrap items-center gap-x-3 gap-y-1", "telemetry sub-line wraps instead of clipping on narrow screens");
assertIncludes(html, "handleGeoSearch", "search results route through activateLiveNavigation");
assertIncludes(html, "fetchRouteElevation", "route elevation batch fetch present");
// 1.16.6 consciously REVISED per §1.6: 'CLIMB +' → the new strip grammar
// (▲/▼ = summed ascent/descent deltas; the range reads as min–max, no longer
// formatted like a fake descent figure). The contract — an elevation strip
// with totals + sparkline — is unchanged.
assertIncludes(html, "ELEV &#9650;${re.gain} m &#9660;${re.loss || 0} m", "route timeline renders the elevation strip with summed ascent/descent (1.16.6 B7)");
assertIncludes(html, "loss += arr[k - 1] - arr[k]", "route elevation accumulates a true descent total (1.16.6 B7)");
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
// 1.16.0 §1.6-conscious retarget: both setters now build _MI from the
// skill-adapted `wEff` (AC-1 Brier closed loop) — the contract (field 'w',
// both setters) is unchanged, only the source variable name moved.
{
  const setAW = html.slice(html.indexOf("this._MI = Object.entries(wEff).map(([m, wVal])"), html.indexOf("this._MI = Object.entries(wEff).map(([m, wVal])") + 120);
  assert(setAW.includes("w: wVal"), "_MI uses field 'w' (not 'weight') in setActiveWeights");
}
{
  // Find the second occurrence (setActiveWeightsAtLead)
  const firstIdx = html.indexOf("this._MI = Object.entries(wEff).map(([m, wVal])");
  const secondIdx = html.indexOf("this._MI = Object.entries(wEff).map(([m, wVal])", firstIdx + 1);
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
assertIncludes(html, "const isWetNowByRadar = !!(_nodeRadar && _nodeRadar.cls && _rrFresh);", "index.html per-node tier-0: a radar echo at a node outranks the model vote (1.16.4 consciously revised per §1.6: the paint is freshness-gated — a fresh echo still outranks the vote, a stale frame abstains exactly like the pin verdict)");
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
assertIncludes(swSrc, "const APP_CACHE = 'meteonexus-app-v30'", "sw.js APP_CACHE v30 — 1.16.9 release gate step 6 (consciously revised per §1.6: index.html changed, so the SW update detector must fire or installed clients never fetch the new shell)");
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
assertIncludes(agentsMd, "tailwindcss-mcp-server", "§12 pins tailwindcss (Tailwind utility lookup, palette, CSS-to-Tailwind conversion — the Tailwind-specific Technique Reference layer Context7's general docs don't cover)");
assertIncludes(agentsMd, "@intellmedia/basecoat-ui-mcp", "§12 pins basecoat-ui (Basecoat UI: 57 shadcn-look component templates without React, macro layouts, theming/dark-mode guidance — offline design reference for UI polish passes)");
assertIncludes(agentsMd, "Tailkits UI MCP is not npm-distributed", "§12 records the Tailkits npm-404 counter-example (proprietary $49/yr local-connector service — unwirable via npx -y, so future sessions don't re-research it)");
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
  for (const key of ["playwright", "github", "chrome-devtools", "context7", "w3c", "lighthouse", "openstreetmap", "tailwindcss", "basecoat-ui"]) {
    assert(Object.prototype.hasOwnProperty.call(opencodeCfg.mcp, key), `opencode.json mcp block has '${key}'`);
  }
  const doctrineServers = {
    context7: "@upstash/context7-mcp",
    w3c: "@shuji-bonji/w3c-mcp",
    lighthouse: "@danielsogl/lighthouse-mcp",
    openstreetmap: "@cyanheads/openstreetmap-mcp-server",
    tailwindcss: "tailwindcss-mcp-server",
    "basecoat-ui": "@intellmedia/basecoat-ui-mcp"
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
// 1.14.3 cyber-safety pipeline: csp-evaluator gate + osv supply-chain gate +
// axe-core a11y fixture (the 1.14.2-approved scanner backlog, shipped as
// pipeline scanners, NOT MCPs — the §12 data-plane ban). Every gate carries
// verify-scanners controls; extending an exception list without a charter
// citation is forbidden (§1.6).
// ---------------------------------------------------------------------------
const cspGateSrc = readFileSync(join(repoRoot, "tests", "csp-evaluator-gate.mjs"), "utf8");
assertIncludes(cspGateSrc, "DOCUMENTED_EXCEPTIONS", "1.14.3: csp-evaluator gate carries the charter-cited exception list");
assertIncludes(cspGateSrc, "AGENTS.md §1.5 load-bearing", "1.14.3: the unsafe-inline exception cites the charter §1.5");
assertIncludes(cspGateSrc, "Removal path: self-host the CDN libraries", "1.14.3: the CDN-origin exception documents its compensating control (SRI) + removal path");
const osvSrc = readFileSync(join(repoRoot, "tests", "osv-audit.mjs"), "utf8");
assertIncludes(osvSrc, "never silence", "1.14.3: osv gate resolution rule — bump past the advisory fixed version, never silence");
assertIncludes(osvSrc, "installedVersion", "1.14.3: osv gate scans INSTALLED versions from node_modules, not declared ranges");
const a11ySpecSrc = readFileSync(join(repoRoot, "tests", "a11y-audit.spec.js"), "utf8");
assertIncludes(a11ySpecSrc, "new Set([])", "1.15.0: axe pin EMPTY — the 1.14.3 fail-set (color-contrast, landmark-one-main, region) was fixed; zero tolerance for any violation from 1.15.0 on (§1.6 pin-shrink documented in HISTORY)");
assertIncludes(a11ySpecSrc, "chrome-error", "1.14.3: a11y fixture documents the headless-shell controllerchange-reload artifact + one-renav workaround");
const pkgJson1 = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
assert(!!(pkgJson1.scripts && pkgJson1.scripts["audit:csp-eval"]), "package.json wires audit:csp-eval");
assert(!!(pkgJson1.scripts && pkgJson1.scripts["audit:osv"]), "package.json wires audit:osv");
assertIncludes(pkgJson1.scripts["audit"], "npm run audit:csp-eval && npm run audit:osv", "the MANDATORY audit chain runs both cyber gates (now 10 scanners)");
assert(!!(pkgJson1.devDependencies && pkgJson1.devDependencies["csp_evaluator"]), "devDep csp_evaluator pinned (Google CSP-bypass analyzer)");
assert(!!(pkgJson1.devDependencies && pkgJson1.devDependencies["@renovatebot/osv-offline"]), "devDep @renovatebot/osv-offline pinned (offline OSV DB)");
assert(!!(pkgJson1.devDependencies && pkgJson1.devDependencies["@axe-core/playwright"]), "devDep @axe-core/playwright pinned (a11y fixture engine)");
assert(!(pkgJson1.dependencies && pkgJson1.dependencies.sharp) && !(pkgJson1.devDependencies && pkgJson1.devDependencies.sharp), "sharp stays RETIRED (2 known vulns at 0.35.3, zero imports — the osv gate's first real finding 2026-10-08)");
const pwCfgSrc = readFileSync(join(repoRoot, "playwright.config.js"), "utf8");
assertIncludes(pwCfgSrc, "a11y-audit\\.spec\\.js", "playwright rig includes the axe a11y fixture in testMatch");
assertIncludes(pwCfgSrc, "127.0.0.1:3000", "playwright rig baseURL is explicit loopback (headless-shell localhost artifact, 2026-10-08)");

// ---------------------------------------------------------------------------
// 1.15.0 Phase 2+3: a11y fail-set fixes (the axe pin shrink), CLS font-swap
// fix, controllerchange activation-window deferral. The a11y spec pin
// revision is a §1.6-conscious change documented in HISTORY: the pin's
// CONTRACT is "the documented current fail-set" — the fail-set was fixed.
// ---------------------------------------------------------------------------
assertIncludes(html, '<main id="app-main" class="contents">', "1.15.0: <main id=app-main> primary landmark (display:contents = zero layout impact) — the axe landmark-one-main + region fix; the nested #main-grid stays a div (inner U2-MERGE grid, not the page landmark)");
assertIncludes(html, "</main>", "1.15.0: the main landmark closes");
assertIncludes(html, '<meta name="description"', "1.15.0: meta description (the Lighthouse SEO fail-set item)");
assertIncludes(html, "display=optional", "1.15.0: fonts display=optional — the CLS font-swap fix (the CWV-trace culprit: 0.0946 of the 0.10 CLS shifted #status-text)");
assertIncludes(html, 'rel="preload" href="https://fonts.gstatic.com/s/inter/', "1.15.0: brand font preloaded at parse time (CLS window shrink)");
assertIncludes(swSrc, "fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2", "1.15.0: brand fonts join the SW CDN precache — instant + shift-free repeat boots");
assert(!/text-gray-500|text-gray-600/.test(html), "1.15.0: gray-500/600 text tokens RETIRED (3.91:1 on dark = axe color-contrast fail; gray-400 passes) — negative guard");
assertIncludes(html, "text-brand-teal tracking-[0.3em] uppercase opacity-80", "1.15.0: Local Telemetry accent raised to opacity-80 (3.43:1 → passes; also the vibrant-accent design rec)");
assertIncludes(html, "setTimeout(() => window.location.reload(), 50); } });", "1.15.0: generic controllerchange self-reload deferred out of the SW activation window (headless-shell ERR_FAILED probe, 1.14.3)");
assertIncludes(html, "setTimeout(() => window.location.reload(), 50); } };", "1.15.0: update-pill _doReload deferred — same event class (SKIP_WAITING controllerchange)");

// ---------------------------------------------------------------------------
// 1.15.1 perf riders: PF-1 pooled radar decode canvas + PF-2 batched SW
// seed. No behavior change — same pixels decoded, same byte sums; only the
// readback path (GPU→CPU) and the seed concurrency change.
// ---------------------------------------------------------------------------
assertIncludes(html, "const _radarCv = document.createElement('canvas');", "index.html 1.15.1 PF-1: pooled radar decode canvas exists at module scope (declared before first use — TDZ-safe)");
assertIncludes(html, "getContext('2d', { willReadFrequently: true })", "index.html 1.15.1 PF-1: pooled context is CPU-backed — kills the Chrome willReadFrequently readback warning logged on every sample");
assertIncludes(html, "_radarCx.drawImage(bmp, 0, 0);", "index.html 1.15.1 PF-1: all three decode sites (coverage, pin, route tiles) draw through the pooled context");
assert(
  (html.match(/document\.createElement\(['"]canvas['"]\)/g) || []).length === 1,
  "index.html 1.15.1 PF-1: exactly ONE canvas creation remains (the _radarCv pool) — the three per-call sites are gone (negative guard)"
);
assertIncludes(swSrc, "const BATCH = 32;", "sw.js 1.15.1 PF-2: map-cache seed reads in bounded parallel batches, not sequential awaits");

// ---------------------------------------------------------------------------
// 1.16.0 Brier closed loop (AC-1): adaptWeightsBySkill pure function +
// wiring through both weight setters (quorum coherence via the _GLOBAL_ACK
// recompute) + persisted skill summary. The static tables are never
// mutated; cold start keeps them provably (fixture-pinned).
// ---------------------------------------------------------------------------
assertIncludes(html, "function adaptWeightsBySkill(skillByModel, baseW, opts)", "index.html 1.16.0 AC-1: pure skill-adaptation function exists (args + Math + Object only — sliced and executed by tests/unit/skill-adapt.test.mjs)");
assertIncludes(html, "const wEff = applySkillAdaptation(w);", "index.html 1.16.0 AC-1: both weight setters route through the skill overlay (adapted weights feed _MI AND the _GLOBAL_ACK quorum baseline together)");
assertIncludes(html, "_activeSkillSig: '',", "index.html 1.16.0 AC-1: skill signature pre-declared on the ensemble object (memo spans regime + skill; hidden-class doctrine)");
assertIncludes(html, "meteo_skill_v1", "index.html 1.16.0 AC-1: skill summary persisted across reloads (scored evidence must survive to reach the minObs gate)");

// ---------------------------------------------------------------------------
// 1.16.1 four-agent bug-hunt round (13 fixes: 7 HIGH + 4 MED accuracy + 1 MED
// perf + 1 MED lifecycle + timer hygiene). Each guard pins the fix line so a
// future edit silently reverting it fails loudly (§1.6: guards are contract).
// ---------------------------------------------------------------------------
assertIncludes(html, "swReg hoisted to initPWA scope", "index.html 1.16.1: swReg hoisted to initPWA scope (update pill was ReferenceError-dead)");
assertIncludes(html, "_speedGlitchStreak", "index.html 1.16.1: leaky speed-glitch latch (sustained accel accepted after 3 trips, spikes still rejected)");
assertIncludes(html, "_selfConsistentCapped", "index.html 1.16.1: COG self-consistent path capped at 90deg (2-fix multipath burst can no longer self-validate)");
assertIncludes(html, "Remaining = live leg (nav.distKm", "index.html 1.16.1: tracking DIST/ETA count down remaining (nav leg + tail), not departure total");
assertIncludes(html, "same ≤10-min age guard as the live-path", "index.html 1.16.1: offline sibling restore age-guarded (stale sea-state class)");
assertIncludes(html, "same ≤10-min age guard as the offline catch above", "index.html 1.16.1: denied-boot sibling restore age-guarded");
assertIncludes(workerSrc, "Skip unresolvable coords instead.", "worker.js 1.16.1: single poisoned Overpass element can no longer blank the whole fuel result");
assertIncludes(html, "const blob = await readBodyOrNull(r, 8000, x => x.blob());", "index.html 1.16.1: route-tile bodies budgeted (headers-then-stall no longer hangs Promise.all)");
assertIncludes(html, "Older frameTime never overwrites newer.", "index.html 1.16.1: route radar commit has frame recency (no time regression)");
assertIncludes(html, "this._activeSkillSig = '\\0';", "index.html 1.16.1: restoreWeights resets the skill memo (default-regime skill loop stays engaged)");
assertIncludes(html, "skill + regime + minutely fingerprints", "index.html 1.16.1: payloadSig carries skill/regime/minutely (adapted weights engage without waiting for a time roll)");
assertIncludes(html, "radar sample-ts age bucket", "index.html 1.16.1: payloadSig carries the radar ts bucket (freshness crossing re-renders)");
assertIncludes(html, "weather_code_' + _m", "index.html 1.16.1: chartSig probes weather_code + gusts (model-only shifts re-render)");
assertIncludes(html, "second prefetch fence", "index.html 1.16.1: purge re-aborts before the wipe (6 s GPS-wait window closed)");
assertIncludes(html, "clear the race timer on settle", "index.html 1.16.1: readBodyOrNull clears its timer + debugs catches");
assertIncludes(swSrc, "batched size collection first", "sw.js 1.16.1: tile eviction batches size collection (PF-2 class)");
assertIncludes(swSrc, "bounded-batch match (PF-2 class)", "sw.js 1.16.1: API eviction batches matches (PF-2 class)");
assertIncludes(swSrc, "meteonexus-app-v30", "sw.js 1.16.9: APP_CACHE v30 (index.html + worker.js + sw.js changed)");

// ---------------------------------------------------------------------------
// 1.16.3 first-real-use UI polish pass (Basecoat design-reference +
// Tailwind technique-reference MCPs, the 1.16.2 PENDING item): the Chrome
// issue-panel "No label associated with a form field (count: 3)" advisory
// (pending since 1.15.0) is closed by explicit label[for] association, and
// the Basecoat native-select dark-mode contract ships as a real-CSS
// declaration (immune to stale precompiled stylesheets). Runtime-proven:
// advisory gone, colorScheme dark live, label.control === select ×3.
// tabular-nums was considered and DECLINED with evidence: every
// high-frequency numeric surface is already monospaced (tabular by
// construction) — no live jitter target, and 1.15.0 forbids blind styling.
// ---------------------------------------------------------------------------
assertIncludes(html, '<label for="pref-brand"', "index.html 1.16.3: Target Brand label programmatically associated (Chrome form-field advisory #1)");
assertIncludes(html, '<label for="pref-variant"', "index.html 1.16.3: Variant label programmatically associated (Chrome form-field advisory #2)");
assertIncludes(html, '<label for="pref-opening-mode"', "index.html 1.16.3: Search Mode label programmatically associated (Chrome form-field advisory #3)");
assertIncludes(html, ":root { color-scheme: dark; }", "index.html 1.16.3: UA control color-scheme declared (Basecoat theming contract — native select popups/carets/autofill/scrollbars render dark, not light-on-black)");

// ---------------------------------------------------------------------------
// 1.16.4 four-agent bug-hunt + performance round (user-directed "Bug Fixes,
// Optimizations, Performance Upgrade"): 31 applied fixes across rotation
// authority, tracking/ETA display, the fetch/verdict/Brier chain, purge
// fencing, PWA lifecycle, and the Aero/UI write paths. Two HIGHs: the COG
// accept-gate permanent wedge (>90° accumulated course change had no
// convergence path — the sideways-arrow class reborn) and the remaining-DIST
// un-gridded tail (display dropped on activation + pinned 0.0 KM up to ~5 km
// early). Every guard below pins a shipped fix line.
// ---------------------------------------------------------------------------
// HIGH-1: COG sustained-new-course rescue
assertIncludes(html, "mapHeading: null, _prevCog: null, _cogSustainStreak: 0", "index.html 1.16.4: _cogSustainStreak pre-declared (hidden-class doctrine; the 1.14.0 rotation-authority literal line extended, pin at 591 preserved)");
assertIncludes(html, "state._cogSustainStreak >= 3", "index.html 1.16.4: 3 consecutive self-consistent fixes beyond the 90° cap accept — a canyon echo PAIR never reaches 3, an accumulated >90° real course unwedges in ~3 fixes instead of forever");
// HIGH-2: remaining-distance tail + honest arrived branch
assertIncludes(html, "* _intervalKm + _tailKm", "index.html 1.16.4: leg branch carries the un-gridded tail (total − N×interval, up to 5 km) — DIST no longer drops the moment nodes+nav populate");
assertIncludes(html, "fastDistance(state.autoCoords.lat, state.autoCoords.lon, state.targetCoords.lat, state.targetCoords.lon) / 1000", "index.html 1.16.4: arrived branch counts down to the DESTINATION (straight-line), not a frozen 0.0 KM / '1M' with up to ~5 km left");
// Speed-spike gate at standstill (consumes the previously-dead lastSpeedTimestamp)
assertIncludes(html, "const _speedSeededRecent = (now - (state.lastSpeedTimestamp || 0)) < 30000;", "index.html 1.16.4: accel gate applies from 0 km/h when a recent accepted fix exists — one multipath Doppler spike from standstill no longer latches ~3 fixes of false speed");
// Route-node radar paint freshness (mirrors the pin's own bounds)
assertIncludes(html, "const isWetNowByRadar = !!(_nodeRadar && _nodeRadar.cls && _rrFresh);", "index.html 1.16.4: per-node WET NOW paint is freshness-gated — a RainViewer outage no longer paints stale echoes while the pin verdict abstains");
// Brier geo-bucket identity
assertIncludes(html, "if (bucketLat === null || bucketLon === null || e.lat !== bucketLat || e.lon !== bucketLon) continue;", "index.html 1.16.4: forecast votes are scored only against the SAME 0.1° bucket's observation — cross-geo (f,o) pairs no longer feed the skill adapter noise");
// Route-intel body budgets (the last unbudgeted .json() sites)
assertIncludes(html, "readBodyOrNull(results[0].value, 15000, x => x.json())", "index.html 1.16.4: route-intel body reads race a 15 s budget — a headers-then-stall no longer freezes the intel timeline for 5 min");
// Offline fetch backoff
assertIncludes(html, "const _retryFloorMs = (state._fetchFailStreak > 0) ? 30000 : 5000;", "index.html 1.16.4: after a failed attempt the GPS-tick trigger paces retries at 30 s — offline no longer re-deserializes the full payload every ~5-6 s (IDB hammering on battery)");
// chartSig lanes
assertIncludes(html, "wind_direction_10m_' + _m", "index.html 1.16.4: chartSig probes wind_direction (Aero wind readout no longer stale ≤1 h on a direction-only model run)");
assertIncludes(html, "precipitation_probability_' + _m", "index.html 1.16.4: chartSig probes precipitation_probability (focus prob column + nativePrecipProb no longer stale ≤1 h)");
// Minutely lane-drop honesty
assertIncludes(html, "window.__METEO_CORE_STATE.minutely = null;", "index.html 1.16.4: a payload WITHOUT minutely_15 clears the published window — rainByMinutely cannot fire off a nowcast up to 3 h old");
// Degenerate-payload guard
assertIncludes(html, "degenerate telemetry payload: hourly.time missing/empty", "index.html 1.16.4: a 200 body without an hourly block throws a NAMED error into the render catch (no freshness stamp, honest retry) instead of a raw TypeError");
// Skill-adaptation hardening
assertIncludes(html, "this._activeSkillSig = '\\0';", "index.html 1.16.4: setActiveWeightsAtLead memo sentinel — a lead-blended table can no longer poison a following short-lead verdict via the regime+skill memo");
assertIncludes(html, "14 * 24 * 3600 * 1000", "index.html 1.16.4: persisted skill row older than 14 days is a cold start, not an adaptation driver from another era's model versions");
// Prefetch debounce invariant
assertIncludes(html, "if (state._prefetchDebounce) clearTimeout(state._prefetchDebounce);", "index.html 1.16.4: re-arm clears the pending debounce — the field always names the pending timer (the purge fences' invariant), no orphaned tile runs");
// Route-intel key widening
assertIncludes(html, "Math.round(route.summary.totalDistance)", "index.html 1.16.4: route_intel cache key carries the route signature — the offline fallback can no longer render a different route's (e.g. pre-pitstop) waypoints");
// Purge fencing of IDB writers
assertIncludes(html, "state._purging = true;", "index.html 1.16.4: purge sets the writer fence flag + kills the GPS watch (no 1 Hz fetch triggers through the wipe window)");
assertIncludes(html, "if (state._purging) return Promise.resolve();", "index.html 1.16.4: fetchData refuses to start inside the purge window");
assertIncludes(html, "if (!state._purging) await localforage.setItem('telemetry_payload'", "index.html 1.16.4: in-flight telemetry persist is fenced during purge — no rows re-land after the wipe");
assertIncludes(html, "if (!state._purging) localforage.setItem('sibling_radar'", "index.html 1.16.4: in-flight radar persist fenced during purge");
// Insecure-context boot honesty
assertIncludes(html, "if (!navigator.geolocation) return;", "index.html 1.16.4: plain-HTTP serves no longer die mid-runApp on an undefined watchPosition — the boot ladder paints the honest card");
// SW reply to dead client
assertIncludes(swSrc, "dead client — reply discarded, non-fatal", "sw.js 1.16.4: CACHE_STATS reply wrapped — posting to a client that reloaded mid-resync no longer rejects unhandled inside waitUntil");
// PWA install button
assertIncludes(html, "hide on BOTH outcomes", "index.html 1.16.4: dismissed install prompt hides the button (previously visible-but-dead until beforeinstallprompt happened to re-fire)");
// Offline fuel module honesty
assertIncludes(html, "OFFLINE DATASET MODULE FAILED TO LOAD", "index.html 1.16.4: a failed dynamic import renders an honest error row instead of an unhandled rejection + silent blank list");
// Aero/UI perf + correctness
assertIncludes(html, "_uiCache._sunPairRef !== sp", "index.html 1.16.4: Sun chip gates on pair identity — no more 3 discarded strings/frame (~180 allocs/s)");
assertIncludes(html, "data coverage — degraded, weight scaled", "index.html 1.16.4: node-health tooltip titles are branch-specific — the FAULTED/no-coverage/degraded hover strings are no longer overwritten by the generic one");
assertIncludes(html, "(km < 1.0 ? Math.round(km * 100) : Math.round(km * 10));", "index.html 1.16.4: visibility keys quantise the ≥1 km range uniformly at 0.1 km — 7.0 km and 70 km no longer alias to one cache key");
assert(!html.includes("if (typeof window.requestCacheStats === 'function') window.requestCacheStats();"), "index.html 1.16.4 (negative guard): the per-render CACHE_STATS query is GONE — its only consumer (#cache-gauge) was retired at 1.8.0, and the SW enumerated the whole map cache per render for a discarded reply");
assertIncludes(html, "printing the mm total twice", "index.html 1.16.4: the duplicate Aero wxm intensity append is documented as removed at its surviving block (double '0.3mm 0.3mm' during active rain)");
// Tracking/recenter hygiene
assertIncludes(html, "a relock makes any armed recenter deadline moot", "index.html 1.16.4: relockDriveMode clears the recenter deadline + both timers — no lying armed state past a mode-button relock");
assertIncludes(html, "(!state.isMapLocked && state.tacticalMode > 0 && !!state.autoCoords)", "index.html 1.16.4: stationary pre-exit's unlocked term is Drive-Mode-gated — Map Mode parked no longer burns full 60 fps frames");
assertIncludes(html, "state.lastHeading !== null && !isNaN(state.lastHeading)", "index.html 1.16.4: dead-reckoning heading fallback has no falsy-zero trap (a true 0° due-north read is respected)");
assertIncludes(html, "Math.min(cursor + 4, nodesToProcess.length)", "index.html 1.16.4: processNodes bypass lookahead checks 3 future nodes as its comment (and the intel mirror) always claimed");
assertIncludes(html, "_trackingEtaKeys.pshow !== shouldShowBar", "index.html 1.16.4: tracking progress-bar visibility toggle is key-gated (was an un-gated DOMTokenList op 60×/s)");
assertIncludes(html, "_trackingEtaKeys.recSecs !== secs", "index.html 1.16.4: RECENTER countdown template builds only when the integer second flips (was 60 strings/s)");

// 1.16.9 — short-route node ladder. Below the first 5 km stride the worker
// planner emitted ZERO nodes: no check-ahead weather point, no radar sample,
// no timeline row, no progress — on exactly the pit-stop hops the fuel
// intercept targets. Ladder: <3 km → 1 node (destination), 3–5 km → 2 nodes
// (midpoint + destination). Long routes unchanged. The card and the INTERCEPT
// chip both mirror the rule; this block pins all three sides.
assertIncludes(workerSrc, "nodeCount = totalDistance < 3000 ? 1 : 2;", "worker.js 1.16.9: sub-5 km routes emit check-ahead nodes (1 below 3 km, 2 below 5 km) instead of zero");
assertIncludes(workerSrc, "if (validNodeCount === 0 && coords.length > 0) {", "worker.js 1.16.9: destination-node floor — a degenerate (~0 km) route still yields one node so the card always has a NEXT anchor");
assertIncludes(html, "Math.floor(rKm2 * 1000 / (CONFIG.routingIntervalNodeDist || 5000)) === 0)", "index.html 1.16.9: the tracking card re-derives the ACTUAL node stride (total/nodes.length) on adaptive routes — the 1.16.4 tail math stays exact");
assertIncludes(html, "summary.totalDistance < 3000 ? 1 : 2", "index.html 1.16.9: the INTERCEPT chip mirrors the ladder — it can no longer print '0 NODES' while the timeline shows the adaptive nodes");

// ---------------------------------------------------------------------------
// 1.16.5 UI improvement audit round (live-proven at the pin, 390x844, night
// mode, 0 red console errors; Basecoat design-reference + built-CSS byte
// checks + Playwright computed-style probes). Seven findings, all fixed:
// F1 surface-600/400 tokens were USED in ~20 markup + JS class strings but
// MISSING from @theme — the built CSS carried zero rules for them (the
// 1.9.0 skew class, live-proven: the focus handle rendered transparent,
// the version badges + HUD separators inherited near-white, checkbox/toggle
// borders fell back to currentColor, hover:bg-surface-600 affordances dead);
// F2 sr-only control focus rings were clipped away by clip-path (keyboard
// users got NO focus indicator on any custom checkbox/toggle);
// F3 the three app modals had no dialog semantics/Escape/backdrop-dismiss/
// focus-management/scroll-lock (grep-proven: only Aero focus had Escape);
// F4 the EV/H2 check mark rendered at the modal corner (absolute sibling,
// no positioned ancestor) and the amenity template's NESTED mark never
// matched peer-checked at all (v4 compiles :where(.peer):checked~* —
// sibling-only, live-proven via the built CSS selector);
// F5 animate-pulse/bounce ignored prefers-reduced-motion (FA's own block
// DOES stop fa-spin — live-proven under emulate reduce);
// F6 the search placeholder was the last gray-500 (~3.6:1);
// F7 fixed HUD elements ignored safe-area insets, the driving-critical
// recenter NOW button was ~32px, and the focus handle was invisible AND
// a 40x4 tap target.
// ---------------------------------------------------------------------------
const twSrc = readFileSync(join(repoRoot, "src", "tailwind.css"), "utf8");
// F1 — theme tokens defined + badge sites retargeted (surface-600 at 1.85:1
// would have regressed the 1.15.0 badge-contrast fix, so the two badges move
// to surface-400; the footer opacity-70 -> 80 mirrors the 1.15.0 accent-label
// precedent and keeps the effective badge ≥ 4.5:1).
assertIncludes(twSrc, "--color-surface-600: #3a3a3a", "src/tailwind.css 1.16.5: surface-600 token DEFINED — the ~20 dead class usages (handle bg, separators, checkbox borders, hover states) resolve at last");
assertIncludes(twSrc, "--color-surface-400: #9ca3af", "src/tailwind.css 1.16.5: surface-400 token DEFINED (SONAR OFF dim state, version badges)");
assertIncludes(html, "text-surface-400 tracking-widest ml-1 opacity-80", "index.html 1.16.7 consciously REVISED per §1.6: header version badge keeps the surface-400 token (1.16.5 contract: loud-but-dim, not inherited white) — the mt-1 baseline nudge the old pin accidentally captured was the defect; the badge now aligns to the title baseline with the footer twin's opacity affordance");
assertIncludes(html, "text-surface-400 tracking-widest uppercase opacity-80", "index.html 1.16.5: footer version badge surface-400 + opacity-80 (effective ~5:1 — the 1.15.0 badge-contrast decision preserved, now via a token that exists)");
// F2 — keyboard focus reveal for sr-only custom controls (real CSS, GEOMETRY-PIN: survives a stale precompiled stylesheet).
assertIncludes(html, "input.sr-only:focus-visible + div { box-shadow: 0 0 0 2px #14b8a6; }", "index.html 1.16.5: sr-only focus ring lands on the VISUAL control (the input's own ring is clip-path-clipped away — live-proven on #pref-toll)");
// F5 — reduced-motion guard for Tailwind's animations (FA ships its own; Tailwind's did not).
assertIncludes(html, ".animate-bounce, .animate-pulse { animation-duration: 0.01ms; animation-iteration-count: 1; }", "index.html 1.16.5: low-conf dot / recenter chip icon / install button respect prefers-reduced-motion (live-proven: pulse 2s kept running under emulate reduce while fa-spin was already FA-guarded at 0.001s)");
// F4 — check marks: label gets `relative` (EV/H2 static + amenity JS template), mark stays a SIBLING of the input.
assert(
  (html.match(/class="relative flex items-center gap-2 cursor-pointer group" id="pref-(ev|h2)-wrap"/g) || []).length === 2,
  "index.html 1.16.5: EV/H2 labels are positioned ancestors — the check mark (absolute left-1.5 top-1.5) lands centered in the 24px box, not at the modal corner (live-proven mark rect [6,6] vs box [57,339] pre-fix)"
);
assertIncludes(html, "'relative flex items-center gap-2 cursor-pointer group' + (disabled", "index.html 1.16.5: amenity label template gets the same relative fix");
assert(
  (html.match(/<div class="absolute left-1\.5 top-1\.5 w-3 h-3 bg-black rounded transition-opacity peer-checked:opacity-100 opacity-0"><\/div>/g) || []).length === 3,
  "index.html 1.16.5: three check marks (EV + H2 + amenity template), all siblings of their sr-only input — peer-checked compiles :where(.peer):checked~* (sibling-only), so the old nested amenity mark never matched and the glyph never showed"
);
assert(
  !/justify-center">\s*<div class="absolute left-1\.5/.test(html),
  "index.html 1.16.5 (negative guard): the nested-mark-inside-the-box pattern is GONE from the amenity template (the peer sibling combinator can never reach it)"
);
// F3 — dialog semantics in markup.
assert(
  (html.match(/role="dialog" aria-modal="true" aria-labelledby="/g) || []).length === 3,
  "index.html 1.16.5: all three app modals carry role=dialog + aria-modal + aria-labelledby (previously plain divs — SR users could wander the background; axe cannot require a role that was never declared, hence the empty pin)"
);
assertIncludes(html, 'id="fuel-settings-title"', "index.html 1.16.5: fuel modal accessible name (Pit Stop Parameters heading)");
assertIncludes(html, 'id="purge-modal-title"', "index.html 1.16.5: purge modal accessible name (Critical Warning heading)");
assertIncludes(html, 'id="magcal-modal-title"', "index.html 1.16.5: magcal modal accessible name (Compass Calibration heading)");
// F3 — behaviour half: showAppModal/closeModal/Escape/Tab-trap/backdrop.
assertIncludes(html, "const APP_MODAL_IDS = ['custom-modal', 'fuel-settings-modal', 'magcal-modal'];", "index.html 1.16.5: modal registry for the a11y behaviours");
assertIncludes(html, "showAppModal('custom-modal');", "index.html 1.16.5: purgeSystem opens through the a11y funnel (opener stored, scroll locked, first control focused — Cancel-first convention)");
assertIncludes(html, "showAppModal('fuel-settings-modal');", "index.html 1.16.5: openFuelSettings opens through the a11y funnel");
assertIncludes(html, "showAppModal('magcal-modal');", "index.html 1.16.5: openMagCalModal opens through the a11y funnel");
assertIncludes(html, "if (!_appModalDismissible(el)) return;", "index.html 1.16.5: Escape/backdrop mirror the CLOSE button's semantics — both skip while every button is disabled (the purge progress state disables Cancel+Confirm for the whole wipe window; a mid-wipe dismissal would strand the narrated flow)");
assertIncludes(html, "const _rf = _modalA11y.returnFocus;", "index.html 1.16.5: closeModal returns focus to the opener (only while focus is still inside the closing modal — never steals)");
assertIncludes(html, "document.body.style.overflow = 'hidden'; _modalA11y.scrollLocked = true;", "index.html 1.16.5: body scroll locks while a modal is open (the panel scrolls internally)");
// F6 — the last gray-500.
assert(
  !html.includes("placeholder-gray-500"),
  "index.html 1.16.5 (negative guard): placeholder-gray-500 RETIRED (~3.6:1 on surface-800 — the one gray-500 the 1.15.0 contrast sweep couldn't see because axe exempts placeholders)"
);
// F7 — handle visibility (rides F1's token) + hit area + copy; safe-area insets; NOW button tap-48.
assertIncludes(html, 'id="focus-drag-handle"', "index.html 1.16.5: focus handle carries an id for the hit-area rule");
assertIncludes(html, "#focus-drag-handle::after { content: ''; position: absolute; left: -6px; right: -6px; top: -12px; bottom: -12px; }", "index.html 1.16.5: handle hit band ~28px with ZERO layout growth (was the only sub-44px target on screen — 40x4 — while also invisible)");
assertIncludes(html, 'title="Tap to expand diagnostics"', "index.html 1.16.5: handle title says Tap (it is a tap target; 'Swipe' was a copy lie)");
assertIncludes(html, 'uppercase tracking-widest overlay-safe">', "index.html 1.16.5: ETA bar honors the notch safe-area (fixed top-2 on mobile previously sat under the status bar)");
assertIncludes(html, 'pointer-events-none overlay-safe"', "index.html 1.16.5: tracking progress bar honors the notch safe-area (fixed top-0)");
assertIncludes(html, 'class="ml-2 bg-black/20 px-4 py-2 rounded-full text-xs tap-48"', "index.html 1.16.5: recenter NOW button meets the driving tap-48 doctrine (was ~32px for a driving-critical control)");

// ---------------------------------------------------------------------------
// 1.16.6 — UI/data-visualization correctness round (live-proven findings)
// ---------------------------------------------------------------------------
// A1 — night-mode dim restored on the merged Environment card. updateClass
// REPLACES the whole className; the JS base string dropped `hud-card`, so
// `body.night .hud-card { filter: brightness(0.72) }` never applied — the
// driver's primary surface stayed FULL-brightness at night while
// header/footer dimmed (live-proven: night:true + cardFilter:"none").
assertIncludes(html, 'updateClass(DOM.mainCard, "hud-card col-span-1 rounded-2xl p-4 md:p-6 transition-colors duration-500 border-4 relative overflow-hidden")', "1.16.6 (A1): the telemetry render's mainCard base string carries hud-card (night dim applies again); surface colors stay markup-only so tone pairs never compete in stylesheet order");
assertIncludes(html, 'updateClass(DOM.mainCard, "hud-card col-span-1 rounded-2xl p-4 md:p-6 flex flex-col', "1.16.6 (A1): paintGpsDownFace carries hud-card too");
assert(
  !html.includes("lg:col-span-5"),
  "1.16.6 (A1, negative guard): the stale lg:col-span-5 from the pre-U2-MERGE grid is GONE (#main-grid is grid-cols-1)"
);
// A2 — live-path null guards (Math.round(null) rendered a plausible fake "0°";
// null + '%' printed the literal "null%"; the wind arrow rotated SOUTH on null).
assertIncludes(html, "(typeof curr.temperature_2m === 'number') ? Math.round(curr.temperature_2m) + '°' : '--'", "1.16.6 (A2): metric temp guards null (no more fake 0°)");
assertIncludes(html, "(typeof curr.relative_humidity_2m === 'number') ? curr.relative_humidity_2m + '%' : '--'", "1.16.6 (A2): metric humidity guards null (no more literal null%)");
assertIncludes(html, "getWindDirection(_wdVal) + (_wdVal !== null ? ` <i class=\"fa-solid fa-arrow-up\" style=\"transform: rotate(${_wdVal + 180}deg);\"></i>` : '')", "1.16.6 (A2): wind-direction arrow omitted when the direction is unknown (null + 180 drew a south arrow beside '--')");
// A3 — stopped-ETA semantics: the bar previously flipped from a live
// wall-clock+remaining countdown to the static TOTAL-trip minutes
// (driveRouteMin) at <5 km/h — mixed semantics, re-jumping at every stop light.
assertIncludes(html, "String(_trackingEtaKeys.etaLiveTxt).split(' · ')[0] + ' · STOP'", "1.16.6 (A3): stopped ETA freezes the last live wall clock with a STOP qualifier (no more total-trip flip)");
// 1.16.8: the freeze-validity signature was consciously REVISED per §1.6 —
// the 1.16.6 remaining-distance key (etaLiveRkm === _rKmQ, 100 m quantised)
// let ordinary GPS wander while parked drop the frozen clock to '--:--'. The
// contract is unchanged (a frozen clock survives a stop, only a route change
// invalidates it); the signature moved to route identity so the contract
// actually holds. Contract revision, not a weakening — the negative case
// (genuine route swap while stopped → honest '--:--') is still enforced.
assertIncludes(html, "_trackingEtaKeys.etaLiveRoute = _routeSigKey;", "1.16.8: the frozen ETA carries a ROUTE-IDENTITY signature (route total + destination + node cursor) — GPS wander while parked no longer invalidates it (revised from the 1.16.6 remaining-distance key per §1.6)");
assertIncludes(html, "_trackingEtaKeys.etaLiveRoute === _routeSigKey", "1.16.8: the STOP freeze is gated on route identity, not live remaining distance");
// 1.16.8: route progress on the driving surface. The telemetry-card tape
// (#tracking-progress-bar, in the card header) scrolls off-screen while
// navigating (measured 390x844: map top never rises above y≈355), so the
// fixed ETA bar carries the same keyed value as a 3px bottom edge. One
// value, one writer — the edge is written from the same prog/progKey
// computation, so the two surfaces can never drift apart.
assertIncludes(html, 'id="tracking-eta-prog"', "1.16.8: the fixed ETA bar carries a route-progress edge element (progress on the driving surface)");
assertIncludes(html, 'id="tracking-eta-prog-fill"', "1.16.8: the progress edge has its own fill (width-keyed writer)");
assertIncludes(html, "_trackingEtaKeys.edgeProg !== prog", "1.16.8: the bar's progress edge width is key-gated (no per-frame style write)");
// 1.16.8: honesty — before the node grid exists (worker computing / failed)
// the NEXT field printed the straight-line DESTINATION distance under a
// node-relative word. It now says DEST.
assertIncludes(html, "nextTxt = 'DEST ' + (displayDistance2 >= 1000", "1.16.8: the nodes-absent fallback labels the destination distance 'DEST' — 'NEXT' described a node-relative number");
// A4 — RAIN_LIKELY node chip: the bottom status row was BLUE while the top
// block of the SAME chip was RED — two severity colors for one verdict.
assertIncludes(html, "status === 'RAIN_LIKELY'    ? 'text-brand-red font-black drop-shadow-md'", "1.16.6 (A4): RAIN_LIKELY chip status row unified to red (matches the top block + the main card's alert tier)");
// A5 — radar mm/h readouts were unguarded raw float interpolation.
assertIncludes(html, "function fmtRadarMmh(v) {", "1.16.6 (A5): guarded radar intensity formatter exists");
assert(
  (html.match(/fmtRadarMmh\(/g) || []).length >= 6,
  "1.16.6 (A5): fmtRadarMmh consumed at all three radar mm/h surfaces (definition + sources note + verdict basis + node chips incl. legend builder)"
);
// B1 — radar intensity legend. The overlay's colors were unexplained; the
// mm/h mapping lived only inside RADAR_CORE_PALETTE as classifier data.
assertIncludes(html, 'id="radar-legend"', "1.16.6 (B1): radar legend container exists over the map");
assertIncludes(html, "function buildRadarLegend() {", "1.16.6 (B1): legend rows are BUILT from RADAR_CORE_PALETTE (legend can never drift from the classifier)");
assertIncludes(html, "RADAR_CORE_PALETTE.filter(p => p.cls === cls)", "1.16.6 (B1): legend rows derive from the palette constant, not a hand-copied table");
assertIncludes(html, "function syncRadarLegend() {", "1.16.6 (B1): single visibility funnel");
assert(
  (html.match(/syncRadarLegend\(\);/g) || []).length === 2,
  "1.16.6 (B1): both ON/OFF paths wired (chip toggle + initMap preference restore) — a restored session shows the legend without a tap"
);
// B2 — the temperature band previously lived on a HIDDEN axis with no scale
// (live screenshot: an unreadable teal blob with no readable values).
assertIncludes(html, "y_temp:  { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }", "1.16.6 (B2): the temp band axis is VISIBLE with ° ticks (band becomes readable; Chart.js offsets the two right axes)");
// B3 — "now" was only the implicit left edge of the 24h slice.
assertIncludes(html, "const _nowLinePlugin = {", "1.16.6 (B3): inline NOW-marker plugin exists (no new CDN dependency)");
assertIncludes(html, "plugins: [_nowLinePlugin],", "1.16.6 (B3): the plugin is registered on the chart");
// B4 — precipitation switched from occluding area-fills to thin lines; GEM
// joins the chart (the footer's consensus % always included GEM's vote).
assertIncludes(html, "label: 'GEM',   data: rainData.ca || []", "1.16.6 (B4): GEM rides as the LAST dataset (index 8 — the tooltip footer reads [6]/[7] for the temp band)");
assertIncludes(html, "rainData = { eu: rEU, us: rUS, de: rDE, jp: rJP, ca: rCA };", "1.16.6 (B4): the GEM precip slice is built in normalizeTelemetryData");
assert(
  !html.includes("backgroundColor: tc.blue    + '33'"),
  "1.16.6 (B4, negative guard): the ECMWF area-fill is GONE (filled lines occluded each other at the 0–2 mm consensus scale)"
);
// B5 — unit/band honesty: AQI top-of-scale collapse + toneless bands.
assertIncludes(html, "aqi <= 300 ? 'VERY UNHEALTHY' : 'HAZARDOUS'", "1.16.6 (B5): AQI bands no longer collapse 151+/201+/301+ into one UNHEALTHY");
assertIncludes(html, "· wind km/h</span>", "1.16.6 (B5): the matrix carries the wind/gust unit hint (Wind/Gust cells were the only unitless columns)");
assertIncludes(html, "covTone: _nocov ? 'none'", "1.16.6 (B5): matrix Cov tone mirrors the badge strip (no-coverage ≠ degraded ≠ FAULTED)");
// B6 — the "< 1 km is fog/rain hazard" color existed only on the Aero meter.
assertIncludes(html, "visKm < 1 ? 'text-brand-red' : visKm < 5 ? 'text-brand-warning'", "1.16.6 (B6): card visibility row carries the hazard colors + Aero-matching precision ladder");
// B8 — outlook chip labels oscillated between HH:MM and +Nh across renders.
assertIncludes(html, "const outlookAbs = needsChartArg && Array.isArray(times) && times.length >= outlookLen;", "1.16.6 (B8): outlook labels are all-or-nothing absolute times (no mixed grammars on one strip)");
// B10 — cosmetics batch.
assertIncludes(html, "String(snKey).padStart(3, '0')", "1.16.6 (B10): Aero speed readout pads to 3 digits (matches the tracking pill; pins box width)");
assertIncludes(html, "temperatureTrend > 0 ? '+' : ''", "1.16.6 (B10): zero trend no longer prints the '+0°/1h' sign lie");
// Runtime-found (live stack-proven at the rig): Chart.js 4.4 installs its
// array-listener shim on EVERY dataset data object; the shim wraps 'splice'
// via `s.apply(...)` with s = the NATIVE method captured at install time.
// Float64Array has no splice → s undefined → the first same-length chart
// update threw "Cannot read properties of undefined (reading 'apply')" from
// inside chart.umd.min.js. LATENT SINCE 1.4.1 (only fires when a same-length
// model-run change re-renders the chart; short sessions never hit it).
assertIncludes(html, "const _setDsData = (idx, arr) => {", "1.16.6 (runtime fix): typed-aware dataset data writer exists (splice plain arrays, reference-swap Float64Arrays)");
assertIncludes(html, "if (Array.isArray(ds.data)) ds.data.splice(0, ds.data.length, ...arr);", "1.16.6 (runtime fix): plain-array datasets keep the in-place splice (the Chart.js shim works there)");
assertIncludes(html, "else ds.data = arr;", "1.16.6 (runtime fix): typed-array datasets swap by reference — verified live: Chart.js re-listens the new object and unlistens the old");
assert(
  !html.includes("datasets[2].data.splice"),
  "1.16.6 (runtime fix, negative guard): the direct Float64Array splice — the exact line the live stack pointed at — is GONE from the update path"
);

// ---------------------------------------------------------------------------
// 1.16.7 — UI polish round (visual/UX: modals, timeline, header, map chrome)
// ---------------------------------------------------------------------------
// Modal entrance animation — the three app modals previously snapped in via a
// bare hidden-class toggle (no transition existed in the modal path).
assertIncludes(html, "@keyframes _modalPanelIn", "1.16.7: modal entrance animation exists (root fade + panel scale-in, restarts on every unhide, no JS change)");
assertIncludes(html, "#custom-modal:not(.hidden), #fuel-settings-modal:not(.hidden), #magcal-modal:not(.hidden) { animation: _modalRootIn 0.16s ease-out; }", "1.16.7: modal roots carry the entrance animation");
assertIncludes(html, "#custom-modal, #fuel-settings-modal, #magcal-modal,", "1.16.7: the modal animations join the prefers-reduced-motion kill list (reduced-motion users keep the instant reveal)");
// Header — tap-48 floor + sonar hover parity + badge alignment.
assert(
  (html.match(/tap-48 justify-center p-0 md:w-auto md:h-auto md:px-5/g) || []).length === 3,
  "1.16.7: all three header buttons (install/purge/sonar) meet the app's own 48px touch floor (were the only frequently-tapped controls at 44px)"
);
assertIncludes(html, 'hover:text-white hover:bg-surface-700 transition-all" title="Sonar audio alerts"', "1.16.7: SONAR button gains the sibling hover treatment + spacing parity (was the only header button with no hover fill, 4px wider than its siblings)");
assertIncludes(html, 'ml-1 opacity-80 hover:opacity-100 transition-opacity" title="Deployed version"', "1.16.7: header version badge drops the mt-1 baseline nudge + matches the footer twin's opacity affordance");
// Section header grammar — teal-sm joins its Intel/Aero siblings.
assertIncludes(html, 'text-sm font-bold text-brand-teal uppercase tracking-widest"><i class="fa-solid fa-microchip mr-2"></i> Environment Processing', "1.16.7: telemetry section header joins the teal-sm grammar (was gray text-xs — the odd one among three section labels)");
// GPS accuracy pill → chip (the STANDBY chip shape).
assertIncludes(html, 'whitespace-nowrap bg-surface-800 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-surface-700"><i class="fa-solid fa-crosshairs', "1.16.7: GNSS accuracy state renders as a chip matching the STANDBY chip (was orphaned bare text next to a full chip)");
assert(
  (html.match(/whitespace-nowrap bg-surface-800 px-2 py-1 md:px-3 md:py-1\.5 rounded-lg border-2 border-surface-700"/g) || []).length === 5,
  "1.16.7: all four GPS-accuracy class variants (ACQUIRING/HIGH/MED/LOW) + the markup base carry the chip shell — every writer agrees"
);
// Search: radius duality, distance column, icons.
assertIncludes(html, "rounded-xl sm:rounded-lg px-3 text-base md:text-sm font-bold text-white placeholder-gray-400", "1.16.7: search input joins the cluster's radius duality (12px mobile / 8px desktop — was 12px beside an 8px button)");
assertIncludes(html, "dKm < 10 ? dKm.toFixed(1) : Math.round(dKm)} km</span>", "1.16.7: geo-search results carry distance-to-user (the primary discriminator between same-named places in a driving app)");
assertIncludes(html, "hover:bg-surface-800 hover:text-white border-b border-surface-800", "1.16.7: search result rows gain a hover accent (bg-only before)");
assertIncludes(html, 'fa-spinner fa-spin mr-2"></i>SEARCHING...', "1.16.7: SEARCHING state carries an icon + normalized ellipsis (was bare text — the only iconless busy state)");
assertIncludes(html, 'fa-circle-xmark mr-2"></i>NO MATCHES', "1.16.7: NO MATCHES state carries an icon");
// Speed pill micro-label unification.
assertIncludes(html, 'text-[9px] font-bold text-brand-orange uppercase">Max', "1.16.7: Max micro-label matches its km/h sibling (8px vs 9px inside one pill for no hierarchy reason)");
// GPS-down desc chip sizing.
assertIncludes(html, "uppercase max-w-[95%] leading-relaxed", "1.16.7: the desc chip wraps long denial copy without overflowing (the 90-char LOCATION BLOCKED string rendered in a chip sized for AWAITING SATELLITE)");
// Purge hover no-op.
assert(
  !html.includes("hover:bg-red-500"),
  "1.16.7 (negative guard): Purge All's hover:bg-red-500 is GONE — brand-red IS red-500, the hover changed nothing"
);
assertIncludes(html, "hover:opacity-90 transition-all uppercase tracking-widest text-sm shadow-[0_0_15px_rgba(239,68,68,0.5)]", "1.16.7: Purge All uses the opacity hover pattern (a visible state change)");
// Accordion: hover affordance + one accent per modal.
assert(
  (html.match(/hover:bg-surface-700\/40 transition-colors">/g) || []).length === 5,
  "1.16.7: all five accordion summaries carry a hover affordance (tappable headers previously had none)"
);
assert(
  !html.includes("open:border-brand-green") && !html.includes("open:border-brand-purple") && !html.includes("open:border-brand-blue/50"),
  "1.16.7 (negative guard): the green/blue/purple section accents are GONE from the Pit Stop accordion — one accent (the modal's orange) per modal; the 4-color rainbow carried no semantic mapping"
);
assertIncludes(html, "text-brand-orange uppercase tracking-widest", "1.16.7: section headers + Download All join the orange accent");
assert(
  (html.match(/peer-checked:bg-brand-orange peer-checked:border-brand-orange flex items-center justify-center/g) || []).length === 3,
  "1.16.7: amenity check marks unified to the orange accent (EV + H2 + amenity template — was green marks beside orange ones in one modal); icon leads the label like every other icon in the modal"
);
assertIncludes(html, 'grid grid-cols-2 gap-2 border-t border-surface-700" id="pref-amenities-list"', "1.16.7: amenities render as a 2-col grid (was a 7-row single-column stack in a max-w-sm modal)");
assert(
  !html.includes("❌") && !html.includes("✅") && !html.includes("⚠️"),
  "1.16.7 (negative guard): the emoji status glyphs are GONE from the offline download rows (raw emoji clashing with the app's Font Awesome icon language)"
);
assertIncludes(html, 'fa-circle-xmark mr-1"></i>Never downloaded', "1.16.7: offline status glyphs are Font Awesome (icon-language consistency)");
assert(
  (html.match(/px-2\.5 py-1\.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors/g) || []).length === 4,
  "1.16.7: the four offline download buttons enlarged toward the tap floor (were ~24px tall at 10px text)"
);
// MagCal status pill constraint.
assertIncludes(html, 'min-w-0 truncate">READY', "1.16.7: MagCal status pill truncates long verdicts (REJECTED — magnetic interference previously crushed against the sample counter)");
assertIncludes(html, 'shrink-0">0 samples', "1.16.7: MagCal sample counter never squeezes (shrink-0)");
// Timeline: badge noise retired + shell cleanup.
assert(
  !html.includes('bg-surface-700 text-gray-300 text-[10px] font-black px-2 py-0.5'),
  "1.16.7 (negative guard): the gray LIVE•NOW badge repeated on EVERY upcoming node is GONE — dozens of identical badges diluted the teal one and added a noise row per card"
);
assert(
  (html.match(/LIVE • NOW<\/span>/g) || []).length === 1,
  "1.16.7: exactly ONE LIVE•NOW badge remains (the nearest upcoming node's teal one)"
);
assertIncludes(html, "shadow-xl ${glow} z-10 p-4 flex flex-col justify-between gap-4 relative shrink-0", "1.16.7: timeline card shell drops the dead transition-all (the element is wholesale-replaced each render — it never ran) + the mb-1 double spacing (the track's gap owns the rhythm)");
// Route-status chip geometry unification.
assert(
  !html.includes("px-4 py-2 rounded-lg"),
  "1.16.7 (negative guard): the oversized transient chip shape (text-sm px-4 py-2, no nowrap) is GONE — the same element previously resized and wrapped whenever a paste/routing error fired"
);
assert(
  (html.match(/px-2 py-1 md:px-3 md:py-1\.5 rounded-lg border-2 border-brand-blue\/30 animate-pulse/g) || []).length === 2,
  "1.16.7: transient status messages use the compact nav-chip geometry (color carries severity, geometry never changes)"
);
// Toast: a11y + icon + safe-area.
assertIncludes(html, "_toastEl.setAttribute('role', 'status');", "1.16.7: toast carries role=status (implicit aria-live=polite — screen readers never announced it)");
assertIncludes(html, "'top:max(1rem, env(safe-area-inset-top))'", "1.16.7: toast honors the notch inset in landscape (env()=0 on desktop is a no-op)");
assertIncludes(html, "_toastEl.appendChild(document.createTextNode(message));", "1.16.7: toast icon is an element + text node (the textContent safety contract holds — never innerHTML with the message)");
assertIncludes(html, "p.icon || 'fa-circle-info'", "1.16.7: leading kind icon — color was the only kind signal on a color-vision-dependent surface");
// Fullscreen Escape parity.
assertIncludes(html, "!APP_MODAL_IDS.some(_appModalVisible) && state.focusedSection", "1.16.7: Escape exits section fullscreen (modals + Aero focus had it; sec-telemetry/map/intel trapped keyboard users behind a 44px icon; modals win when both are open)");
// Ellipsis normalization.
assert(
  !html.includes("ACQUIRING GPS…"),
  "1.16.7 (negative guard): the U+2026 ellipsis is retired from status strings (byte-verified 10-site mix with ASCII '...' — one glyph now)"
);
assert(
  (html.match(/"ACQUIRING GPS\.\.\."/g) || []).length === 2,
  "1.16.7: both boot-retry sites use the normalized ASCII ellipsis"
);

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
