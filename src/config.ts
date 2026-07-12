// ============================================================
// METEONEXUS - CONFIGURATION
// Single source of truth for all constants, thresholds, API endpoints
// ============================================================

export const CONFIG = {
  // --- API ENDPOINTS ---
  weatherApi: 'https://api.open-meteo.com/v1/forecast',
  reverseGeoApi: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
  edgeProxy: 'https://gmaps-proxy.strikefreedomnine.workers.dev',
  overpassApi: 'https://overpass-api.de/api/interpreter',
  valhallaEndpoints: [
    'https://valhalla1.openstreetmap.de/route',
    'https://valhalla.openstreetmap.de/route'
  ],

  // --- CACHING ---
  cacheTTL: 300_000,                    // 5 min
  cacheDistThresholdKm: 1.5,            // refetch if moved > 1.5 km
  mapCacheName: 'meteonexus-map-cache',
  apiCacheName: 'meteonexus-api-cache',

  // --- ROUTING ---
  routingIntervalNodeDist: 5000,        // 5 km per node

  // --- SENSORS ---
  gpsDeadband: 2.0,                     // degrees - ignore heading changes < this
  speedGateKmh: 5,                      // GNSS heading only trusted above this speed

  // --- THEME ---
  themeColors: {
    teal: '#14b8a6', blue: '#3b82f6', purple: '#a855f7',
    orange: '#f59e0b', red: '#ef4444', success: '#22c55e', warning: '#eab308'
  }
} as const;

// ============================================================
// WEATHER ENSEMBLE CONFIGURATION
// Single source of truth: models, weights, thresholds, all blend math
// ============================================================

export const ENSEMBLE_MODELS = [
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'jma_seamless'
] as const;

export type EnsembleModel = typeof ENSEMBLE_MODELS[number];

export const ENSEMBLE_WEIGHTS: Record<EnsembleModel, number> = {
  ecmwf_ifs025: 0.35,
  gfs_seamless: 0.35,
  icon_seamless: 0.15,
  jma_seamless: 0.15
};

export const ENSEMBLE_LABELS: Record<EnsembleModel, string> = {
  ecmwf_ifs025: 'EU',
  gfs_seamless: 'US',
  icon_seamless: 'DE',
  jma_seamless: 'JP'
};

export const ENSEMBLE_THRESHOLDS = {
  WET_THRESHOLD_MM: 0.1,       // per-model precipitation floor
  WET_POSSIBLE_PCT: 40,        // weighted % → RAIN_POSSIBLE
  WET_LIKELY_PCT: 75,          // weighted % → RAIN_LIKELY + sonar trigger
  HEALTH_DEGRADED_PCT: 80,     // below this coverage → "degraded" (yellow)
  HEALTH_DOWN_PCT: 20          // below this coverage → "down" (red)
} as const;

// ============================================================
// FUEL CATALOG
// ============================================================

export const FUEL_CATALOG = {
  "Shell": ["V-Power Racing", "V-Power Gasoline", "V-Power Diesel", "FuelSave Gasoline", "FuelSave Diesel"],
  "Petron": ["Blaze 100", "XCS", "Xtra Advance", "Turbo Diesel", "Diesel Max"],
  "Caltex": ["Platinum with Techron", "Silver with Techron", "Diesel with Techron D"],
  "Seaoil": ["Extreme 97", "Extreme 95", "Extreme U", "Exceed Diesel"],
  "Unioil": ["Euro 5 Premium 97", "Euro 5 Premium 95", "Euro 5 Unleaded 91", "Euro 5 Diesel"],
  "Cleanfuel": ["Premium 95", "Clean91", "Diesel", "AutoLPG"],
  "Flying V": ["Thunder Plus", "Thunder", "Unleaded", "Diesel"],
  "PTT": ["Blue Innovation 97", "Blue Innovation 95", "Blue Innovation 91", "Blue Diesel"],
  "Phoenix": ["Premium 98", "Premium 95", "Super Unleaded", "Diesel"]
} as const;

export const BRAND_LINKS = {
  "Shell": "https://find.shell.com/ph/fuel/locations/en_PH",
  "Petron": "https://www.petron.com/station-finder/",
  "Caltex": "https://www.caltex.com/ph/find-a-caltex-station.html",
  "Seaoil": "https://www.seaoil.com.ph/station-locator",
  "Unioil": "https://unioil.com/station-locator",
  "Cleanfuel": "https://www.cleanfuel.ph/stations/",
  "Flying V": "https://www.flyingv.com.ph/station-locator/",
  "PTT": "https://www.pttphilippines.com/station-locator/",
  "Phoenix": "https://www.phoenixfuels.ph/station-locator/"
} as const;

export const VARIANT_OSM_MAP: Record<string, string> = {
  "Blaze 100": "fuel:octane_100", "XCS": "fuel:octane_95", "Xtra Advance": "fuel:octane_91",
  "Turbo Diesel": "fuel:diesel", "Diesel Max": "fuel:diesel",
  "V-Power Racing": "fuel:octane_98", "V-Power Gasoline": "fuel:octane_95", "V-Power Diesel": "fuel:diesel",
  "FuelSave Gasoline": "fuel:octane_91", "FuelSave Diesel": "fuel:diesel",
  "Platinum with Techron": "fuel:octane_95", "Silver with Techron": "fuel:octane_91", "Diesel with Techron D": "fuel:diesel",
  "Extreme 97": "fuel:octane_97", "Extreme 95": "fuel:octane_95", "Extreme U": "fuel:octane_91", "Exceed Diesel": "fuel:diesel",
  "Euro 5 Premium 97": "fuel:octane_97", "Euro 5 Premium 95": "fuel:octane_95",
  "Euro 5 Unleaded 91": "fuel:octane_91", "Euro 5 Diesel": "fuel:diesel",
  "Premium 95": "fuel:octane_95", "Clean91": "fuel:octane_91", "Diesel": "fuel:diesel", "AutoLPG": "fuel:lpg",
  "Thunder Plus": "fuel:octane_95", "Thunder": "fuel:octane_91", "Unleaded": "fuel:octane_91",
  "Blue Innovation 97": "fuel:octane_97", "Blue Innovation 95": "fuel:octane_95",
  "Blue Innovation 91": "fuel:octane_91", "Blue Diesel": "fuel:diesel",
  "Premium 98": "fuel:octane_98", "Super Unleaded": "fuel:octane_91"
};

// ============================================================
// WMO LOOKUP TABLES
// ============================================================

export const WMO_CODES: Record<number, string> = {
  0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing Rime Fog', 51: 'Light Drizzle', 53: 'Moderate Drizzle', 55: 'Dense Drizzle',
  56: 'Light Freezing Drizzle', 57: 'Dense Freezing Drizzle',
  61: 'Slight Rain', 63: 'Moderate Rain', 65: 'Heavy Rain',
  66: 'Light Freezing Rain', 67: 'Heavy Freezing Rain',
  71: 'Slight Snow Fall', 73: 'Moderate Snow Fall', 75: 'Heavy Snow Fall', 77: 'Snow Grains',
  80: 'Slight Rain Showers', 81: 'Moderate Rain Showers', 82: 'Violent Rain Showers',
  85: 'Slight Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + Hail', 99: 'Heavy Thunderstorm + Hail'
};

export const WMO_ICONS: Record<number, string> = {
  0: 'fa-sun', 1: 'fa-sun', 2: 'fa-cloud-sun', 3: 'fa-cloud',
  45: 'fa-smog', 48: 'fa-smog', 51: 'fa-cloud-rain', 53: 'fa-cloud-rain', 55: 'fa-cloud-showers-heavy',
  56: 'fa-cloud-meatball', 57: 'fa-cloud-meatball',
  61: 'fa-cloud-rain', 63: 'fa-cloud-showers-heavy', 65: 'fa-cloud-showers-water',
  66: 'fa-cloud-meatball', 67: 'fa-cloud-meatball',
  71: 'fa-snowflake', 73: 'fa-snowflake', 75: 'fa-snowflake', 77: 'fa-snowflake',
  80: 'fa-cloud-rain', 81: 'fa-cloud-showers-heavy', 82: 'fa-cloud-showers-water',
  85: 'fa-snowflake', 86: 'fa-snowflake',
  95: 'fa-cloud-bolt', 96: 'fa-cloud-bolt', 99: 'fa-cloud-bolt'
};

// ============================================================
// CARDINAL DIRECTIONS
// ============================================================

export const CARDINAL_LUT = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

export function getCardinalStr(deg: number): string {
  return CARDINAL_LUT[Math.floor((deg / 22.5) + 0.5) & 15];
}

export function getWindDirection(deg: number): string {
  return getCardinalStr(deg);
}