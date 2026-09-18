// Unit suite — executes fuel-stations.js via real ESM import.
//
// Covers the pure/observable surface: BrandAdapters (shell/caltex/generic),
// SearchEngine.isOpenNow, and a full in-memory findNearby integration pass
// (bounding-box pre-filter -> haversine -> variant/amenity/hours filters ->
// sort) with StationLoader.load patched to a fixture — no network, no
// localforage. The patch is restored after each test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrandAdapters, StationLoader, SearchEngine } from '../../fuel-stations.js';

// ---------- BrandAdapters.shell ----------

test('shell adapter maps pricing to fuels and amenities booleans', () => {
  const s = BrandAdapters.shell({
    id: 'sh1', name: 'Shell West', lat: 52.5, lng: 13.4,
    formatted_address: 'Av. Always Live 12',
    fuel_pricing: { prices: { fuelsave_98: 1, vpower_gasoline: null, vpower_diesel: 2, fuelsave_95: 3, fuelsave_diesel: null, shell_regular_diesel: null, premium_diesel: null } },
    standard_toilet: true, childs_toilet: null, shop: 'shop', atm: null,
    ev_charging: 'x', hydrogen_offering: null, carwash_opening_hours: null,
    forecourt_opening_hours: '24/7', shop_opening_hours: null,
    open_status: 'open', tz_offset: 2, next_open_status_change: null,
    twenty_four_hour: false, bakery_shop: null
  });
  assert.deepEqual(s.fuels, ['V-Power Racing', 'V-Power Diesel', 'FuelSave Gasoline']);
  assert.equal(s.amenities.toilet, true);
  assert.equal(s.amenities.shop, true);
  assert.equal(s.amenities.ev, true);
  assert.equal(s.amenities.carwash, false);
  assert.equal(s.is24_7, false);
  assert.equal(s.hours.openStatus, 'open');
});

test('shell adapter falls back to ["Fuel"] when every price is null', () => {
  const s = BrandAdapters.shell({
    id: 'sh2', name: 'X', lat: 1, lng: 2,
    fuel_pricing: { prices: { fuelsave_98: null, vpower_gasoline: null, vpower_diesel: null, fuelsave_95: null, fuelsave_diesel: null, shell_regular_diesel: null, premium_diesel: null } }
  });
  assert.deepEqual(s.fuels, ['Fuel']);
});

test('shell adapter treats MISSING price keys as unoffered (post-fix regression)', () => {
  const s = BrandAdapters.shell({
    id: 'sh3', name: 'X', lat: 1, lng: 2,
    fuel_pricing: { prices: { fuelsave_diesel: 3 } } // every other key absent
  });
  assert.deepEqual(s.fuels, ['FuelSave Diesel']);
});

test('shell adapter toilet is OR-combined across standard/childs fields', () => {
  const base = { id: 't', name: 'T', lat: 0, lng: 0, fuel_pricing: { prices: {} } };
  const a = BrandAdapters.shell({ ...base, standard_toilet: null, childs_toilet: 'y' });
  const b = BrandAdapters.shell({ ...base, standard_toilet: null, childs_toilet: null });
  assert.equal(a.amenities.toilet, true);
  assert.equal(b.amenities.toilet, false);
});

test('shell adapter hoursKnown: published status known, absent unknown, 24-7 known (A3)', () => {
  const base = { id: 'hk', name: 'HK', lat: 0, lng: 0, fuel_pricing: { prices: {} } };
  assert.equal(BrandAdapters.shell({ ...base, open_status: 'open', twenty_four_hour: false }).hours.hoursKnown, true);
  assert.equal(BrandAdapters.shell({ ...base, open_status: null, twenty_four_hour: true }).hours.hoursKnown, true);
  assert.equal(BrandAdapters.shell({ ...base, open_status: null, twenty_four_hour: false }).hours.hoursKnown, false);
});

test('caltex adapter hoursKnown: operating hours or 24-7 known, else unknown (A3)', () => {
  const withHours = BrandAdapters.caltex({ id: 'c1', name: 'C1', lat: 0, lng: 0, operating_hours: '06:00-22:00' });
  const always = BrandAdapters.caltex({ id: 'c2', name: 'C2', lat: 0, lng: 0, operating_hours: null, twenty_four_hour: true });
  const dark = BrandAdapters.caltex({ id: 'c3', name: 'C3', lat: 0, lng: 0, operating_hours: null });
  assert.equal(withHours.hours.hoursKnown, true);
  assert.equal(always.hours.hoursKnown, true);
  assert.equal(dark.hours.hoursKnown, false);
});

// ---------- BrandAdapters.caltex ----------

test('caltex adapter maps amenity ids per the live-dataset-proven table', () => {
  // Id semantics proven against all 731 rows of caltex_stations.json:
  // 3002=Toilet, 3003=Disabled Friendly Toilet, 3000=Convenience Store,
  // 3001=7-11, 3007=Car Wash, 3006=Lube Bay (NOT carwash), 66043=CaltexGO
  // Rewards (NOT atm), 66030=Power Diesel (fuel_ids only, NOT ev).
  const s = BrandAdapters.caltex({
    id: 'cx1', name: 'Caltex Central', lat: -33.8, lng: 151.2,
    street: '1 George St', city: 'Sydney', state: 'NSW',
    filter_ids: 'amenityid_3007', amenity_ids: '3002,3000,66043',
    fuels: ['Diesel'], operating_hours: 'Open 24/7'
  });
  assert.equal(s.address, '1 George St, Sydney, NSW');
  assert.deepEqual(
    { toilet: s.amenities.toilet, shop: s.amenities.shop, carwash: s.amenities.carwash, atm: s.amenities.atm, ev: s.amenities.ev },
    { toilet: true, shop: true, carwash: true, atm: false, ev: false }
  );
  assert.equal(s.is24_7, true);
});

test('caltex adapter: prefixed tokens, disabled-toilet id, no false atm/ev', () => {
  const s = BrandAdapters.caltex({
    id: 'cx2', name: 'C', lat: 0, lng: 0,
    filter_ids: 'amenityid_3003,fuelid_66030', amenity_ids: '',
    operating_hours: 'Mon-Sun 06:00-22:00'
  });
  assert.equal(s.amenities.toilet, true);   // 3003 = Disabled Friendly Toilet
  assert.equal(s.amenities.shop, false);    // 3001 (7-11) NOT present here
  assert.equal(s.amenities.ev, false);      // fuelid_66030 must not leak into ev
  assert.equal(s.amenities.atm, false);     // no ATM id exists in the dataset
  assert.equal(s.is24_7, false);
});

test('caltex adapter recognises the "24 hours" spelling', () => {
  const s = BrandAdapters.caltex({ id: 'cx3', name: 'C', lat: 0, lng: 0, operating_hours: 'Open 24 hours' });
  assert.equal(s.is24_7, true);
});

// ---------- BrandAdapters.generic ----------

test('generic adapter defaults all amenities false and never 24-7', () => {
  const s = BrandAdapters.generic({ id: 'g1', name: 'G', lat: 1, lng: 2, address: 'Somewhere 3' });
  assert.equal(s.address, 'Somewhere 3');
  assert.deepEqual(Object.values(s.amenities).every(v => v === false), true);
  assert.equal(s.is24_7, false);
});

// ---------- SearchEngine.isOpenNow ----------

test('isOpenNow honours per-brand status semantics', () => {
  const shell = (status, is24 = false) => ({ hours: { openStatus: status }, is24_7: is24 });
  assert.equal(SearchEngine.isOpenNow(shell('open'), 'shell'), true);
  assert.equal(SearchEngine.isOpenNow(shell('closed'), 'shell'), false);
  assert.equal(SearchEngine.isOpenNow(shell('twenty_four_hour'), 'shell'), true);
  assert.equal(SearchEngine.isOpenNow(shell('unknown-status'), 'shell'), true); // unknown -> optimistic
  const caltex = (is24, operating) => ({ is24_7: is24, hours: { operating } });
  assert.equal(SearchEngine.isOpenNow(caltex(true, null), 'caltex'), true);
  assert.equal(SearchEngine.isOpenNow(caltex(false, '06:00-22:00'), 'caltex'), true);
  assert.equal(SearchEngine.isOpenNow(caltex(false, null), 'caltex'), false);
  assert.equal(SearchEngine.isOpenNow({}, 'otherbrand'), true);
});

// ---------- findNearby (integration, loader patched) ----------

const CENTER = { lat: 52.5, lon: 13.4 };

function rawStation(id, dLat, dLon = 0, overrides = {}) {
  return { id, name: `S${id}`, lat: CENTER.lat + dLat, lng: CENTER.lon + dLon, ...overrides };
}

async function withLoader(raw, fn) {
  const original = StationLoader.load;
  StationLoader.load = async () => raw;
  try { return await fn(); } finally { StationLoader.load = original; }
}

test('findNearby: radius filter, distance sort, and dist reporting', async () => {
  await withLoader([
    rawStation('near', 0.010),   // ~1.11 km north
    rawStation('mid', 0.050),    // ~5.55 km
    rawStation('far', 0.300)     // ~33 km -> rejected
  ], async () => {
    const res = await SearchEngine.findNearby({ ...CENTER, brand: 'radiusTest', radiusKm: 20 });
    assert.equal(res.source, 'local');
    assert.deepEqual(res.stations.map(s => s.id), ['near', 'mid']);
    assert.ok(res.stations[0].dist < res.stations[1].dist);
    assert.ok(Math.abs(res.stations[0].dist - 1.11) < 0.05);
  });
});

test('findNearby: full shell funnel — coords, variant, amenities, hours filters', async () => {
  // Raw records shaped for BrandAdapters.shell: fuels derive from non-null
  // pricing fields, amenities from OSM presence fields, hours from
  // open_status / twenty_four_hour. One brand key = one fixture dataset;
  // repeated findNearby calls reuse the warm adapted cache deterministically.
  const shellRaw = [
    { id: 'ok-all', name: 'A', lat: CENTER.lat + 0.010, lng: CENTER.lon,
      fuel_pricing: { prices: { fuelsave_95: 1 } }, shop: 'shop', standard_toilet: 'y',
      open_status: 'open', twenty_four_hour: false },
    // "Nothing offered" modeled with explicit nulls (post-fix, missing keys
    // are ALSO treated as unoffered — see the dedicated regression test).
    { id: 'wrong-variant', name: 'B', lat: CENTER.lat + 0.011, lng: CENTER.lon,
      fuel_pricing: { prices: { fuelsave_98: null, vpower_gasoline: null, vpower_diesel: null, fuelsave_95: null, fuelsave_diesel: null, shell_regular_diesel: null, premium_diesel: null } },
      shop: 'shop', standard_toilet: 'y',
      open_status: 'open', twenty_four_hour: false },
    { id: 'no-shop', name: 'C', lat: CENTER.lat + 0.012, lng: CENTER.lon,
      fuel_pricing: { prices: { fuelsave_95: 1 } }, shop: null, standard_toilet: 'y',
      open_status: 'open', twenty_four_hour: false },
    { id: 'closed', name: 'D', lat: CENTER.lat + 0.013, lng: CENTER.lon,
      fuel_pricing: { prices: { fuelsave_95: 1 } }, shop: 'shop', standard_toilet: 'y',
      open_status: 'closed', twenty_four_hour: false },
    { id: 'always-open', name: 'E', lat: CENTER.lat + 0.014, lng: CENTER.lon,
      fuel_pricing: { prices: { fuelsave_95: 1 } }, shop: 'shop', standard_toilet: 'y',
      open_status: null, twenty_four_hour: true },
    { id: 'no-coords', name: 'F' }
  ];

  await withLoader(shellRaw, async () => {
    // (a) unfiltered: coordinates-less station rejected, rest pass radius
    const base = await SearchEngine.findNearby({ ...CENTER, brand: 'shell', radiusKm: 20 });
    assert.deepEqual(base.stations.map(s => s.id),
      ['ok-all', 'wrong-variant', 'no-shop', 'closed', 'always-open']);

    // (b) variant + amenity + open_now funnel narrows to the fully-equipped
    // open hit AND the round-the-clock hit (unknown status stays optimistic)
    const filtered = await SearchEngine.findNearby({
      ...CENTER, brand: 'shell', variant: 'FuelSave Gasoline',
      amenities: ['shop', 'toilet'], openingMode: 'open_now'
    });
    assert.deepEqual(filtered.stations.map(s => s.id), ['ok-all', 'always-open']);

    // (c) open_now drops explicit 'closed' status; unknown stays optimistic
    const openNow = await SearchEngine.findNearby({ ...CENTER, brand: 'shell', openingMode: 'open_now' });
    assert.equal(openNow.stations.some(s => s.id === 'closed'), false);
    assert.equal(openNow.stations.some(s => s.id === 'always-open'), true);

    // (d) 24_7 keeps only round-the-clock stations
    const roundClock = await SearchEngine.findNearby({ ...CENTER, brand: 'shell', openingMode: '24_7' });
    assert.deepEqual(roundClock.stations.map(s => s.id), ['always-open']);
  });
});

test('findNearby: stations without coordinates are rejected before distance math', async () => {
  await withLoader([
    { id: 'no-coords', name: 'N' },
    rawStation('fine', 0.005)
  ], async () => {
    const res = await SearchEngine.findNearby({ ...CENTER, brand: 'coordBrand' });
    assert.deepEqual(res.stations.map(s => s.id), ['fine']);
  });
});

test('findNearby: NaN coordinates are rejected (post-fix regression)', async () => {
  // Regression for the guard gap: NaN passed every numeric filter
  // (`NaN < min` and `NaN > radius` are both false) and entered results.
  await withLoader([
    { id: 'nan-lat', name: 'L', lat: NaN, lng: CENTER.lon },
    { id: 'nan-lng', name: 'G', lat: CENTER.lat + 0.01, lng: NaN },
    rawStation('clean', 0.005)
  ], async () => {
    const res = await SearchEngine.findNearby({ ...CENTER, brand: 'nanBrand', radiusKm: 20 });
    assert.deepEqual(res.stations.map(s => s.id), ['clean']);
  });
});

test('findNearby: A2 ellipsoidal distance matches WGS84 reference arcs', async () => {
  // Reference values on the WGS84 ellipsoid:
  //   1 deg longitude at the equator = 111,319.49 m
  //   1 deg latitude  at the equator = 110,574.27 m
  // The old constant-R haversine gave ~111.195 km for BOTH bearings.
  await withLoader([
    { id: 'east', name: 'E', lat: 0, lng: 1 },
    { id: 'north', name: 'N', lat: 1, lng: 0 }
  ], async () => {
    const res = await SearchEngine.findNearby({ lat: 0, lon: 0, brand: 'a2Brand', radiusKm: 200 });
    const east = res.stations.find(s => s.id === 'east').dist;
    const north = res.stations.find(s => s.id === 'north').dist;
    assert.ok(Math.abs(east - 111.3195) < 0.05, `east: ${east}`);
    assert.ok(Math.abs(north - 110.5743) < 0.05, `north: ${north}`);
  });
});

test('findNearby: loader failure degrades to an error result, not a throw', async () => {
  const original = StationLoader.load;
  StationLoader.load = async () => { throw new Error('disk exploded'); };
  try {
    const res = await SearchEngine.findNearby({ ...CENTER, brand: 'boomTest' });
    assert.equal(res.stations.length, 0);
    assert.match(res.error, /disk exploded/);
  } finally { StationLoader.load = original; }
});
