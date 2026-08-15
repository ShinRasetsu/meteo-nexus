// fuel-stations.js — Local station loader, brand adapters & search engine
// Lazy-loaded ES module. No side effects on import.
/* global localforage, fetch, console */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── In-memory memoization for loaded stations ───
const _stationCache = new Map(); // brand -> { raw: [], adapted: [], ts: number }

// ─── Fast bounding-box pre-filter constants ───
const _DEG2KM = 111.32; // 1° lat ≈ 111.32 km

// ─── Optimized Haversine (pre-computes cos(lat) for multiple calls) ───
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const cosLat1 = Math.cos(lat1 * p);
  const cosLat2 = Math.cos(lat2 * p);
  const a = Math.sin(dLat / 2) ** 2 + cosLat1 * cosLat2 * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── StationLoader ───
// PERF: single-flight latch. findAllAlongRoute fans ~15 parallel findNearby
// calls at the same brand; every miss cascaded into a full 2.8 MB JSON fetch
// + 2.8 MB IndexedDB write per concurrent caller (17 concurrent downloads on
// first route search). The latch collapses concurrent loads of the same brand
// into one network/disk pass — losers await the winner's promise.
const _loadInFlight = new Map(); // brandKey -> Promise<raw>
export const StationLoader = {
  async load(brand) {
    const key = `fuel_stations_${brand.toLowerCase()}`;
    const mem = _stationCache.get(brand.toLowerCase());
    if (mem && Date.now() - mem.ts < CACHE_TTL_MS) return mem.raw;
    const inflight = _loadInFlight.get(brand.toLowerCase());
    if (inflight) return inflight;

    const p = (async () => {
      try {
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
    if (pricing.fuelsave_98 !== null) fuels.push('V-Power Racing');
    if (pricing.vpower_gasoline !== null) fuels.push('V-Power Gasoline');
    if (pricing.vpower_diesel !== null) fuels.push('V-Power Diesel');
    if (pricing.fuelsave_95 !== null) fuels.push('FuelSave Gasoline');
    if (pricing.fuelsave_diesel !== null) fuels.push('FuelSave Diesel');
    if (pricing.shell_regular_diesel !== null) fuels.push('Diesel');
    if (pricing.premium_diesel !== null) fuels.push('Premium Diesel');
    if (!fuels.length) fuels.push('Fuel'); // fallback

    return {
      id: raw.id,
      name: raw.name,
      lat: raw.lat,
      lon: raw.lng,
      address: raw.formatted_address,
      fuels,
      amenities: {
        toilet: raw.standard_toilet !== null || raw.childs_toilet !== null,
        shop: raw.shop !== null,
        atm: raw.atm !== null,
        ev: raw.ev_charging !== null,
        hydrogen: raw.hydrogen_offering !== null,
        carwash: raw.carwash_opening_hours !== null,
        bakery: raw.shop === 'bakery_shop' || raw.bakery_shop !== null
      },
      hours: {
        forecourt: raw.forecourt_opening_hours,
        shop: raw.shop_opening_hours,
        ev: raw.ev_opening_hours,
        openStatus: raw.open_status, // 'open' | 'closed' | 'twenty_four_hour'
        tzOffset: raw.tz_offset,
        nextChange: raw.next_open_status_change
      },
      is24_7: raw.twenty_four_hour === true
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
        openStatus: raw.operating_hours ? 'unknown' : 'unknown'
      },
      is24_7: /24[/\\-]?7|twenty.four.hour/i.test(raw.operating_hours || '')
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
const _caltexAmenityKeys = {
  toilet: '3001', shop: '3002', carwash: '3006', atm: '66043', ev: '66030'
};
function parseCaltexAmenities(filterIds, amenityIds) {
  const tokens = new Set(
    String(filterIds || '').split(',').concat(String(amenityIds || '').split(','))
  );
  const has = (id) => tokens.has(id) || tokens.has('amenityid_' + id) || tokens.has('fuelid_' + id);
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