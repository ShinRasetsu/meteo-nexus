// Unit suite — executes the worker math kernel for real (not scanned).
//
// Loads worker.js into a vm sandbox with a `self` stub, then exercises every
// exported behaviour: fastDistance, decodeValhallaPolyline,
// calculateRouteNodes, processOverpassPayload, AND the onmessage dispatcher
// including its error path. Also proves the intentional fastDistance
// duplication between worker.js and the inline module (index.html) stays
// bit-identical — AGENTS.md sec 10 prohibits diverging copies.
//
// Scope honesty: telemetry normalization (normalizeTelemetryData) is NOT
// unit-tested here — it closes over module-scope state/WeatherEnsemble and is
// covered by the Fetch Gate runtime pass instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

// ---------- load worker.js into a sandbox ----------

function makeWorkerSandbox() {
  const posted = [];
  const sandbox = {
    self: { onmessage: null, postMessage: (msg) => posted.push(msg) }
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'worker.js' });
  return { sandbox, posted };
}

// Slice a top-level function out of a source string by brace counting.
// Deterministic, no regex-over-indentation fragility.
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in source`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

function evalStandalone(fnSrc) {
  return vm.runInNewContext(`(${fnSrc})`);
}

const { sandbox: freshWorker } = makeWorkerSandbox();
const w = freshWorker; // function declarations land on the context object

// Normalize vm-realm objects into host-realm copies so node:assert's
// prototype-aware deepStrictEqual can compare them.
function host(v) { return JSON.parse(JSON.stringify(v)); }

// ---------- fastDistance ----------

test('fastDistance: identical point returns 0', () => {
  assert.equal(w.fastDistance(52.5, 13.4, 52.5, 13.4), 0);
});

test('fastDistance: 1 degree of longitude at the equator is ~111195 m', () => {
  const d = w.fastDistance(0, 13.0, 0, 14.0);
  assert.ok(Math.abs(d - 111194.9) < 1.5, `got ${d}`);
});

test('fastDistance: symmetric and monotonic', () => {
  const ab = w.fastDistance(52.5, 13.4, 52.6, 13.5);
  const ba = w.fastDistance(52.6, 13.5, 52.5, 13.4);
  assert.equal(ab, ba);
  const near = Math.abs(w.fastDistance(0, 0, 0, 1));
  const far = Math.abs(w.fastDistance(0, 0, 0, 2));
  assert.ok(near < far);
});

test('fastDistance: non-finite inputs yield NaN (guard branch)', () => {
  assert.equal(Number.isNaN(w.fastDistance(NaN, 0, 0, 0)), true);
  assert.equal(Number.isNaN(w.fastDistance(0, Infinity, 0, 0)), true);
});

// ---------- fastDistance duplication parity (AGENTS.md sec 10) ----------

test('worker fastDistance is bit-identical to the main-thread mirror', () => {
  const extract = fs.readFileSync(path.join(here, '..', '_module_extract.mjs'), 'utf8');
  const mainFnSrc = sliceFunction(extract, 'fastDistance');
  const mainFastDistance = evalStandalone(mainFnSrc);
  const grid = [];
  for (let lat = -80; lat <= 80; lat += 37.3) {
    for (let lon = -179; lon <= 179; lon += 73.7) {
      grid.push([lat, lon, lat + 0.51, lon - 0.27]);
      grid.push([lat + 0.11, lon + 0.09, lat, lon]);
    }
  }
  for (const [a, b, c, d] of grid) {
    assert.equal(mainFastDistance(a, b, c, d), w.fastDistance(a, b, c, d), `grid ${a},${b},${c},${d}`);
  }
});

// ---------- decodeValhallaPolyline (round-trip via independent encoder) ----------

function encodeValue(v) {
  let x = v < 0 ? ~(v << 1) : (v << 1);
  let out = '';
  while (x >= 0x20) { out += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
  return out + String.fromCharCode(x + 63);
}
function encodePolyline(points) {
  let pLat = 0, pLng = 0, out = '';
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e6), iLng = Math.round(lng * 1e6);
    out += encodeValue(iLat - pLat) + encodeValue(iLng - pLng);
    pLat = iLat; pLng = iLng;
  }
  return out;
}

test('decodeValhallaPolyline: round-trips an independent encoder output', () => {
  const route = [
    [52.500000, 13.400000],
    [52.512345, 13.415678],
    [52.520000, 13.390000],
    [-33.865143, 151.209900]
  ];
  const decoded = w.decodeValhallaPolyline(encodePolyline(route));
  assert.equal(decoded.length, route.length);
  route.forEach(([lat, lng], i) => {
    assert.ok(Math.abs(decoded[i].lat - lat) < 1e-6, `lat idx ${i}: ${decoded[i].lat}`);
    assert.ok(Math.abs(decoded[i].lng - lng) < 1e-6, `lng idx ${i}: ${decoded[i].lng}`);
  });
});

test('decodeValhallaPolyline: empty input returns empty array', () => {
  assert.deepEqual(host(w.decodeValhallaPolyline('')), []);
});

// ---------- calculateRouteNodes ----------

const EQ_STEP_DEG = 0.001;
const EQ_STEP_M = 12742000 * Math.asin(Math.sin((EQ_STEP_DEG * Math.PI / 180) / 2));

function straightLineCoords(n, useLonKey = false) {
  return Array.from({ length: n }, (_, i) => (
    useLonKey ? { lat: 0, lon: i * EQ_STEP_DEG } : { lat: 0, lng: i * EQ_STEP_DEG }
  ));
}

test('calculateRouteNodes: places nodes at requested intervals with sequential ids', () => {
  const coords = straightLineCoords(100); // ~11119 m total
  const total = 99 * EQ_STEP_M;
  const nodes = w.calculateRouteNodes(total, coords, 500);
  assert.equal(nodes.length, Math.floor(total / 500));
  nodes.forEach((n, i) => {
    assert.equal(n.id, i + 1);
    assert.equal(n.passed, false);
    if (i > 0) assert.ok(nodes[i - 1].lon < n.lon, 'nodes must advance monotonically');
  });
});

test('calculateRouteNodes: .lon fallback branch matches .lng branch exactly', () => {
  const total = 99 * EQ_STEP_M;
  const viaLng = w.calculateRouteNodes(total, straightLineCoords(50, false), 700);
  const viaLon = w.calculateRouteNodes(total, straightLineCoords(50, true), 700);
  assert.deepEqual(viaLon, viaLng);
});

test('calculateRouteNodes: duplicate points never produce NaN nodes', () => {
  const coords = [
    { lat: 10, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 10 },
    { lat: 10.001, lng: 10.001 }
  ];
  const nodes = w.calculateRouteNodes(200, coords, 50);
  for (const n of nodes) {
    assert.equal(Number.isFinite(n.lat), true);
    assert.equal(Number.isFinite(n.lon), true);
  }
});

test('calculateRouteNodes: empty coords return empty array', () => {
  assert.deepEqual(host(w.calculateRouteNodes(1000, [], 100)), []);
  assert.deepEqual(host(w.calculateRouteNodes(1000, null, 100)), []);
});

// ---------- processOverpassPayload ----------

const CENTER = { lat: 52.5, lon: 13.4 };

function overpassEl(id, lat, lon, tags = {}, withCenter = false) {
  return withCenter
    ? { id, center: { lat, lon }, tags }
    : { id, lat, lon, tags };
}

test('processOverpassPayload: sorts by distance, dedupes rounded coords, defaults names', () => {
  const data = { elements: [
    overpassEl(2, CENTER.lat + 0.05, CENTER.lon),
    overpassEl(1, CENTER.lat + 0.01, CENTER.lon),
    overpassEl(3, CENTER.lat + 0.01, CENTER.lon), // duplicate of #1 after rounding
    overpassEl(4, CENTER.lat + 0.001, CENTER.lon + 0.002, { name: 'Centred' }, true) // center fallback shape
  ] };
  const res = w.processOverpassPayload(data, CENTER.lat, CENTER.lon, 'Shell', 'Diesel', null);
  assert.equal(res.isStrict, false);
  assert.equal(res.stations.length, 3); // dup dropped, center element kept
  const dists = res.stations.map(s => s.distMeters);
  assert.deepEqual(dists.sort((a, b) => a - b), dists.slice().sort((a, b) => a - b));
  for (let i = 1; i < res.stations.length; i++) {
    assert.ok(res.stations[i - 1].distMeters <= res.stations[i].distMeters, 'ascending order');
  }
  const unnamed = res.stations.find(s => Math.abs(s.lat - (CENTER.lat + 0.05)) < 1e-9);
  assert.equal(unnamed.name, 'Shell');
  const centred = res.stations.find(s => s.name === 'Centred');
  assert.ok(centred, 'center-fallback element keeps its tags.name');
});

test('processOverpassPayload: strict filter keeps only exact brand-tag hits', () => {
  const data = { elements: [
    overpassEl(1, CENTER.lat + 0.01, CENTER.lon, { ['fuel:diesel']: 'yes' }),
    overpassEl(2, CENTER.lat + 0.02, CENTER.lon, {}),
    overpassEl(3, CENTER.lat + 0.03, CENTER.lon, { ['fuel:diesel']: 'yes' })
  ] };
  const res = w.processOverpassPayload(data, CENTER.lat, CENTER.lon, 'Shell', 'Diesel', 'fuel:diesel');
  assert.equal(res.isStrict, true);
  assert.equal(res.stations.every(s => s.isExact && s.strictFilterActive), true);
  assert.equal(res.stations.length, 2);
});

test('processOverpassPayload: caps at TOP_K=32 using nearest-first replacement', () => {
  const elements = [];
  for (let i = 40; i >= 1; i--) elements.push(overpassEl(i, CENTER.lat + 0.001 * i, CENTER.lon));
  elements.push(overpassEl(999, CENTER.lat + 0.0001, CENTER.lon)); // nearest, arrives last
  const res = w.processOverpassPayload({ elements }, CENTER.lat, CENTER.lon, 'Shell', 'Any', null);
  assert.equal(res.stations.length, 32);
  assert.equal(res.stations[0].distMeters, w.fastDistance(CENTER.lat, CENTER.lon, CENTER.lat + 0.0001, CENTER.lon));
  assert.equal(res.stations.some(s => s.name === 'Shell' && s.distMeters > res.stations[31].distMeters), false);
});

test('processOverpassPayload: empty payload returns empty non-strict result', () => {
  assert.deepEqual(host(w.processOverpassPayload({ elements: [] }, 0, 0, 'X', 'Y', null)), { stations: [], isStrict: false });
  assert.deepEqual(host(w.processOverpassPayload({}, 0, 0, 'X', 'Y', null)), { stations: [], isStrict: false });
});

// ---------- dispatcher (real message flow through self.onmessage) ----------

test('dispatcher: valid task posts { messageId, result }', () => {
  const { sandbox, posted } = makeWorkerSandbox();
  sandbox.self.onmessage({ data: {
    type: 'DECODE_VALHALLA', messageId: 7,
    payload: { shape: encodePolyline([[1.5, 2.5], [3.5, 4.5]]) }
  } });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].messageId, 7);
  assert.equal(posted[0].error, undefined);
  assert.equal(posted[0].result.length, 2);
  assert.equal(posted[0].result[1].lat, 3.5);
});

test('dispatcher: unknown task posts error + stack, never throws synchronously', () => {
  const { sandbox, posted } = makeWorkerSandbox();
  assert.doesNotThrow(() => sandbox.self.onmessage({ data: { type: 'NOPE', messageId: 8, payload: {} } }));
  assert.equal(posted[0].messageId, 8);
  assert.match(posted[0].error, /Unknown worker task vector/);
  assert.equal(typeof posted[0].stack, 'string');
});

// ---------- main-thread pure helpers (sliced from the extracted module) ----------

function sliceConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`${name} not found`);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

const extractSrc = fs.readFileSync(path.join(here, '..', '_module_extract.mjs'), 'utf8');
const getWindDirection = vm.runInNewContext(
  sliceConst(extractSrc, 'WIND_DIR_ARR') + '\n' +
  sliceFunction(extractSrc, 'getWindDirection') + '\ngetWindDirection;'
);

test('getWindDirection maps degrees to the 16-point compass table', () => {
  assert.equal(getWindDirection(0), 'N');
  assert.equal(getWindDirection(45), 'NE');
  assert.equal(getWindDirection(90), 'E');
  assert.equal(getWindDirection(270), 'W');
  assert.equal(getWindDirection(359.9), 'N');
});

test('getWindDirection normalizes negatives and rejects junk', () => {
  assert.equal(getWindDirection(-90), 'W');   // (-90 % 360 + 360) % 360 = 270
  assert.equal(getWindDirection(-1), 'N');    // 359 deg rounds to the nearest sector: N
  assert.equal(getWindDirection(null), '--');
  assert.equal(getWindDirection(NaN), '--');
});
