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

// Local PWA icons + iOS apple-touch-icon
assertIncludes(html, '<link rel="apple-touch-icon"', "index.html has apple-touch-icon for iOS");
assertIncludes(html, './icon-180.png', "index.html references local icon-180.png");

// No custom-auth-token injection surface
assert(
  !/__initial_auth_token/.test(html),
  "index.html does NOT expose __initial_auth_token injection surface"
);

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

// Worker dispatch surface (must match worker.js)
assertIncludes(html, "DECODE_VALHALLA", "main thread can request DECODE_VALHALLA");
assertIncludes(html, "CALCULATE_NODES", "main thread can request CALCULATE_NODES");
assertIncludes(html, "PROCESS_OVERPASS", "main thread can request PROCESS_OVERPASS");

// ---------------------------------------------------------------------------
// worker.js — task dispatcher integrity
// ---------------------------------------------------------------------------
const workerSrc = readFileSync(join(repoRoot, "worker.js"), "utf8");
for (const type of ["DECODE_VALHALLA", "CALCULATE_NODES", "PROCESS_OVERPASS"]) {
  assertIncludes(workerSrc, `case '${type}'`, `worker.js handles ${type}`);
}
assertIncludes(workerSrc, "self.onmessage", "worker.js listens for messages");
assertIncludes(workerSrc, "self.postMessage", "worker.js posts results back");

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
