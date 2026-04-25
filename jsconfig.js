// CONFIG
export const CONFIG = {
  weatherApi: 'https://api.open-meteo.com/v1/forecast',
  geocoderApi: 'https://geocoding-api.open-meteo.com/v1/search',
  reverseGeoApi: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
  osrmApi: 'https://router.project-osrm.org/route/v1/driving/',

  sonarThreshold: 75,
  vectorUpdateIntervalMs: 60000,
  gridDistanceDeltaKm: 2,
  gridTimeDeltaMs: 300000,

  speedHistoryMaxSamples: 60,
  movingSpeedMinKph: 3,
  sinuosityFactor: 1.35
};

// SUPABASE
export const SUPABASE_CONFIG = {
  URL: 'https://myhcnbqzafygqnfxykdd.supabase.co',
  KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};