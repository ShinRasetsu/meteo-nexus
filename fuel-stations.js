// fuel-stations.js — Local station loader, brand adapters & search engine
// Lazy-loaded ES module. No side effects on import.
/* global localforage, fetch, console */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── In-memory memoization for loaded stations ───
const _stationCache = new Map(); // brand -> { raw: [], adapted: [], ts: number }

// ─── Fast bounding-box pre-filter constants ───
const _DEG2KM = 111.32; // 1° lat ≈ 111.32 km

// ─── Ellipsoidal point-to-point distance (A2) ───
// Direction-aware equirectangular on WGS84 expansion series (meters per
// degree of lat / lon at the midpoint latitude). Accurate to <0.05% across
// all bearings for search-range hops; the previous constant-R haversine was
// up to ~0.5% off depending on bearing/latitude — enough to misrank
// near-tie stations. Hot rejection paths elsewhere stay spherical.
const _D2R = Math.PI / 180;
function _meridionalMPerDeg(latDeg) {
  const c2 = Math.cos(2 * latDeg * _D2R);
  const c4 = Math.cos(4 * latDeg * _D2R);
  return 111132.954 - 559.822 * c2 + 1.175 * c4;
}
function _parallelMPerDeg(latDeg) {
  const c1 = Math.cos(latDeg * _D2R);
  const c3 = Math.cos(3 * latDeg * _D2R);
  const c5 = Math.cos(5 * latDeg * _D2R);
  return 111412.84 * c1 - 93.5 * c3 + 0.118 * c5;
}
// Historical name kept for call-site stability; no longer literal haversine.
function haversineKm(lat1, lon1, lat2, lon2) {
  const midLat = (lat1 + lat2) / 2;
  const dNorth = (lat2 - lat1) * _meridionalMPerDeg(midLat);
  const dEast = (lon2 - lon1) * _parallelMPerDeg(midLat);
  return Math.sqrt(dNorth * dNorth + dEast * dEast) / 1000;
}

// ─── StationLoader ───
// PERF: single-flight latch. findAllAlongRoute fans ~15 parallel findNearby
// calls at the same brand; every miss cascaded into a full 2.8 MB JSON fetch
// + 2.8 MB IndexedDB write per concurrent caller (17 concurrent downloads on
// first route search). The latch collapses concurrent loads of the same brand
// into one network/disk pass — losers await the winner's promise.
const _loadInFlight = new Map(); // brandKey -> Promise<raw>
export const StationLoader = {
  // opts.force: skip the mem + IndexedDB TTL early-returns (the Offline tab's
  // Refresh button must actually hit the network — without this a tap on
  // "Refresh" into a fresh cache is a silent no-op).
  async load(brand, opts = {}) {
    const force = opts.force === true;
    const key = `fuel_stations_${brand.toLowerCase()}`;
    const mem = _stationCache.get(brand.toLowerCase());
    if (!force && mem && Date.now() - mem.ts < CACHE_TTL_MS) return mem.raw;
    const inflight = _loadInFlight.get(brand.toLowerCase());
    if (inflight) return inflight;

    const p = (async () => {
      if (!force) try {
        const cached = await localforage.getItem(key);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
          _stationCache.set(brand.toLowerCase(), { raw: cached.data, adapted: null, ts: cached.ts });
          return cached.data;
        }
      } catch { /* ignore cache read errors */ }

      const res = await fetch(`./${brand.toLowerCase()}_stations.json`);
      if (!res.ok) throw new Error(`Failed to load ${brand} stations: ${res.status}`);
      const data = await res.json();
      const ts = Date.now();
      // FIX-1.4.1b (H3): getFreshness() must not decode the whole dataset to
      // read ts/size — localforage deserialises the ENTIRE stored value on
      // getItem (2.8MB JSON per poll). A 200-byte meta entry carries the same
      // freshness facts; the data entry itself stays untouched.
      // FIX-1.4.1c (A-5): the two 2.8 MB JSON.stringify calls were redundant —
      // size is computed once and shared by the data row and the meta row.
      const size = JSON.stringify(data).length;
      try {
        await localforage.setItem(key, { data, ts, size });
        await localforage.setItem(`${key}_meta`, { ts, size });
      } catch { /* ignore write errors */ }
      _stationCache.set(brand.toLowerCase(), { raw: data, adapted: null, ts: Date.now() });
      return data;
    })().finally(() => { _loadInFlight.delete(brand.toLowerCase()); });
    _loadInFlight.set(brand.toLowerCase(), p);
    return p;
  },

  async getFreshness(brand) {
    const key = `fuel_stations_${brand.toLowerCase()}`;
    // FIX-1.4.1b (H3): read the 200-byte meta entry instead of the full
    // dataset — localforage decodes the whole stored value on getItem, and
    // the old code deserialised 2.8MB of stations per freshness poll.
    // Fall back to the legacy full read only for entries written before
    // this fix (no meta key present).
    try {
      const meta = await localforage.getItem(`${key}_meta`);
      if (meta && typeof meta.ts === 'number') {
        const ageMs = Date.now() - meta.ts;
        return {
          status: ageMs < CACHE_TTL_MS ? 'fresh' : 'stale',
          ageMs,
          size: typeof meta.size === 'number' ? meta.size : 0
        };
      }
      const cached = await localforage.getItem(key);
      if (!cached) return { status: 'never', ageMs: null, size: 0 };
      const ageMs = Date.now() - cached.ts;
      return {
        status: ageMs < CACHE_TTL_MS ? 'fresh' : 'stale',
        ageMs,
        // PERF: size was computed once at fetch time (the 2.8 MB JSON.stringify
        // per freshness poll was pure waste — same bytes every time). Legacy
        // entries without the stored size fall back to one-time stringify.
        size: typeof cached.size === 'number' ? cached.size : JSON.stringify(cached.data).length
      };
    } catch (err) { return { status: 'error', ageMs: null, size: 0, error: err.message }; }
  },

  async downloadAll(onProgress) {
    const brands = ['shell', 'caltex'];
    for (const brand of brands) {
      onProgress?.(brand, 'downloading');
      await this.load(brand);
      onProgress?.(brand, 'done');
    }
  }
};

// ─── BrandAdapters — normalize to common schema ───
export const BrandAdapters = {
  shell: (raw) => {
    const fuels = [];
    const pricing = raw.fuel_pricing?.prices || {};
    // FIX (unit-audit): `!== null` treated a MISSING key as offered
    // (`undefined !== null` is true), so partial payloads advertised fuels
    // they never priced. `!= null` rejects both null and undefined.
    if (pricing.fuelsave_98 != null) fuels.push('V-Power Racing');
    if (pricing.vpower_gasoline != null) fuels.push('V-Power Gasoline');
    if (pricing.vpower_diesel != null) fuels.push('V-Power Diesel');
    if (pricing.fuelsave_95 != null) fuels.push('FuelSave Gasoline');
    if (pricing.fuelsave_diesel != null) fuels.push('FuelSave Diesel');
    if (pricing.shell_regular_diesel != null) fuels.push('Diesel');
    if (pricing.premium_diesel != null) fuels.push('Premium Diesel');
    // FIX: live pricing values are null in 1124/1124 rows, so the block above
    // never fires and every station fell back to ['Fuel'] — variant search
    // always missed locally (offline Shell broken for variants). The same
    // vocabulary lives populated in raw.fuels; map it to catalog names.
    // Mapping is description-backed (co-occurrence counts, 2026-09-17 probe):
    // premium_gasoline 386/386 with "V-Power Gasoline", premium_diesel 917/917
    // with "V-Power Diesel", fuelsave_regular_diesel 720/720 with "FuelSave
    // Diesel", fuelsave_midgrade_gasoline 980/980 with "FuelSave Unleaded",
    // shell_regular_diesel 70/70 with "Diesoline", super_premium_gasoline 4/4
    // + super98 4/4 with "V-Power Racing" (4 descs); unleaded_super overlaps
    // fuelsave_midgrade 361/378 (regional alias). Pricing stays authoritative
    // when non-null (checked above); this only fills gaps.
    if (!fuels.length && Array.isArray(raw.fuels)) {
      const rf = raw.fuels;
      const push = (v) => { if (!fuels.includes(v)) fuels.push(v); };
      if (rf.includes('fuelsave_98') || rf.includes('super_premium_gasoline') || rf.includes('super98')) push('V-Power Racing');
      if (rf.includes('premium_gasoline')) push('V-Power Gasoline');
      if (rf.includes('premium_diesel')) push('V-Power Diesel');
      if (rf.includes('fuelsave_midgrade_gasoline') || rf.includes('unleaded_super') || rf.includes('midgrade_gasoline')) push('FuelSave Gasoline');
      if (rf.includes('fuelsave_regular_diesel')) push('FuelSave Diesel');
      if (rf.includes('shell_regular_diesel')) push('Diesel');
    }
    if (!fuels.length) fuels.push('Fuel'); // fallback

    return {
      id: raw.id,
      name: raw.name,
      lat: raw.lat,
      lon: raw.lng,
      address: raw.formatted_address,
      fuels,
      amenities: {
        // FIX: top-level standard_toilet/shop/atm/bakery keys exist in 0/1124
        // live rows (real signals live in the `amenities` ARRAY) — `!== null`
        // on a missing key is always true, so every station advertised
        // toilet+shop+atm+bakery. Read the array first; keep a `!= null`
        // top-level fallback for legacy shapes. `!= null` rejects both null
        // and undefined (the pricing-block fix class).
        toilet: (raw.amenities || []).includes('standard_toilet') || (raw.amenities || []).includes('childs_toilet') || raw.standard_toilet != null || raw.childs_toilet != null,
        shop: (raw.amenities || []).includes('shop') || (raw.amenities || []).includes('selectshop') || raw.shop != null,
        atm: (raw.amenities || []).includes('atm') || (raw.amenities || []).includes('atm_in') || (raw.amenities || []).includes('atm_out') || raw.atm != null,
        ev: raw.ev_charging != null,
        hydrogen: raw.hydrogen_offering != null,
        carwash: raw.carwash_opening_hours != null,
        bakery: (raw.amenities || []).includes('bakery_shop') || raw.shop === 'bakery_shop' || raw.bakery_shop != null
      },
      hours: {
        forecourt: raw.forecourt_opening_hours,
        shop: raw.shop_opening_hours,
        ev: raw.ev_opening_hours,
        openStatus: raw.open_status, // 'open' | 'closed' | 'twenty_four_hour'
        tzOffset: raw.tz_offset,
        nextChange: raw.next_open_status_change,
        // A3: explicit knowledge flag so the UI can badge "hours unknown"
        // instead of silently implying confirmed-open. 24/7 counts as known.
        hoursKnown: ['open', 'closed', 'twenty_four_hour'].includes(raw.open_status) ||
                    raw.twenty_four_hour === true
      },
      // FIX: `twenty_four_hour` top-level key exists in 0/1124 live rows;
      // the live signal is open_status === 'twenty_four_hour' (741/1124)
      // plus a `twenty_four_hour` token in the amenities array.
      is24_7: raw.open_status === 'twenty_four_hour' || (raw.amenities || []).includes('twenty_four_hour') || raw.twenty_four_hour === true
    };
  },

  caltex: (raw) => {
    const amenities = parseCaltexAmenities(raw.filter_ids, raw.amenity_ids);
    return {
      id: raw.id,
      name: raw.name,
      lat: raw.lat,
      lon: raw.lng,
      address: [raw.street, raw.city, raw.state].filter(Boolean).join(', '),
      fuels: raw.fuels || [],
      amenities,
      hours: {
        operating: raw.operating_hours,
        openStatus: raw.operating_hours ? 'unknown' : 'unknown',
        hoursKnown: raw.operating_hours != null || raw.twenty_four_hour === true
      },
      // "24 hours"/"24hours" spellings appear in 4 live rows alongside 24/7.
      is24_7: /24[/\\-]?7|24\s*hours|twenty.four.hour/i.test(raw.operating_hours || '')
    };
  },

  // Generic fallback for brands without local data
  generic: (raw) => ({
    id: raw.id,
    name: raw.name,
    lat: raw.lat,
    lon: raw.lng,
    address: raw.address || raw.formatted_address || '',
    fuels: raw.fuels || [],
    amenities: { toilet: false, shop: false, atm: false, ev: false, hydrogen: false, carwash: false, bakery: false },
    hours: { operating: raw.operating_hours || null },
    is24_7: false
  })
};

// ─── Optimized Caltex amenity parser (single pass, no array concat) ───
// id table PROVEN against all 731 rows of caltex_stations.json by
// positional co-occurrence of amenity_ids[] with amenities[] (100%
// consistent, zero collisions):
//   3000 = Convenience Store (58)   3001 = 7-11 (92)
//   3002 = Toilet (152)             3003 = Disabled Friendly Toilet (13)
//   3006 = Lube Bay (110)           3007 = Car Wash (75)
//   66030 = Power Diesel  — fuel_ids ONLY, never amenity_ids (NOT an EV id)
//   66043 = Caltex Rewards / CaltexGO (567 rows — NOT an ATM id)
// No ATM/EV id exists in the local dataset: those filters honestly match
// nothing instead of lying, and the UI's source badge stays LOCAL with an
// empty list rather than a wrong one. (Multi-id per amenity = array.)
const _caltexAmenityKeys = {
  toilet: ['3002', '3003'], shop: ['3000', '3001'], carwash: ['3007'], atm: [], ev: []
};
function parseCaltexAmenities(filterIds, amenityIds) {
  const tokens = new Set(
    String(filterIds || '').split(',').concat(String(amenityIds || '').split(','))
  );
  // FIX: fuel ids share the numeric namespace with amenity ids
  // (filter_ids mixes fuelid_3001 with amenityid_3002) — matching the
  // fuelid_ prefix turned diesel fuel tokens into ev/toilet=true.
  // Match bare tokens (amenity_ids) + amenityid_ prefix only.
  const has = (ids) => ids.some(id => tokens.has(id) || tokens.has('amenityid_' + id));
  return {
    toilet: has(_caltexAmenityKeys.toilet),
    shop: has(_caltexAmenityKeys.shop),
    carwash: has(_caltexAmenityKeys.carwash),
    atm: has(_caltexAmenityKeys.atm),
    ev: has(_caltexAmenityKeys.ev),
    hydrogen: false,
    bakery: false
  };
}

// ─── SearchEngine ───
export const SearchEngine = {
  async findNearby({ lat, lon, brand, variant, amenities = [], openingMode = 'all', radiusKm = 20 }) {
    const brandKey = brand.toLowerCase();
    const adapter = BrandAdapters[brandKey] || BrandAdapters.generic;
    let rawStations;
    try {
      rawStations = await StationLoader.load(brand);
    } catch (e) {
      console.warn(`[SearchEngine] Failed to load ${brand} stations:`, e);
      return { stations: [], source: 'local', error: e.message };
    }

    // Get or build adapted stations (memoized per brand)
    let mem = _stationCache.get(brandKey);
    if (!mem) mem = { raw: rawStations, adapted: null, ts: Date.now() };
    let stations = mem.adapted;
    if (!stations) {
      stations = rawStations
        .map(adapter)
        .filter(s => s.lat != null && s.lon != null);
      _stationCache.set(brandKey, { ...mem, adapted: stations, ts: mem.ts });
    }

    // Fast bounding-box pre-filter before expensive haversine
    const results = [];
    const latMin = lat - radiusKm / _DEG2KM;
    const latMax = lat + radiusKm / _DEG2KM;
    const lonKmPerDeg = _DEG2KM * Math.cos(lat * Math.PI / 180);
    const lonMin = lon - radiusKm / lonKmPerDeg;
    const lonMax = lon + radiusKm / lonKmPerDeg;

    for (const s of stations) {
      // FIX (unit-audit): NaN coordinates passed every numeric guard below
      // (all NaN comparisons are false), letting broken records through as
      // NaN-distance results. Reject non-finite coords explicitly.
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;

      // Quick bounding box reject
      if (s.lat < latMin || s.lat > latMax || s.lon < lonMin || s.lon > lonMax) continue;
      
      // Exact haversine
      const dist = haversineKm(lat, lon, s.lat, s.lon);
      if (dist > radiusKm) continue;
      
      // Variant filter
      if (variant && variant !== 'Any' && !s.fuels.includes(variant)) continue;
      
      // Amenities filter
      let ok = true;
      for (const a of amenities) { if (s.amenities[a] !== true) { ok = false; break; } }
      if (!ok) continue;
      
      // Opening hours filter
      if (openingMode !== 'all') {
        if (openingMode === '24_7') { if (!s.is24_7) continue; }
        else if (openingMode === 'open_now') { if (!this.isOpenNow(s, brand)) continue; }
      }
      
      results.push({ ...s, dist });
    }

    results.sort((a, b) => a.dist - b.dist);
    return { stations: results, source: 'local' };
  },

  isOpenNow(station, brand) {
    if (brand === 'shell') {
      if (station.hours.openStatus === 'twenty_four_hour') return true;
      if (station.hours.openStatus === 'open') return true;
      if (station.hours.openStatus === 'closed') return false;
      return true;
    }
    if (brand === 'caltex') {
      if (station.is24_7) return true;
      return !!station.hours.operating;
    }
    return true;
  }
};