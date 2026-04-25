// ==========================================
// CORE.JS - Configuration, State, and Utilities
// ==========================================

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

export const SUPABASE_CONFIG = {
  URL: 'https://myhcnbqzafygqnfxykdd.supabase.co',
  KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};

export const state = {
  mode: localStorage.getItem('ms_mode') || 'auto',
  coords: JSON.parse(localStorage.getItem('ms_coords')) || { lat: null, lon: null },
  autoCoords: null,
  targetTimezone: null,
  chart: null,
  audioEnabled: false,
  lastPing: 0,
  watchId: null,
  lastGridFetchTime: 0,
  lastVectorFetchTime: 0,
  magHeading: null,
  currentMotion: {
    lat: 0,
    lon: 0,
    speedKph: 0,
    gpsHeading: null
  },
  wakeLock: null,
  maxSpeed: parseFloat(localStorage.getItem('ms_maxSpeed')) || 0,
  speedHistory: JSON.parse(localStorage.getItem('ms_speedHistory')) || [],
  destination: JSON.parse(localStorage.getItem('ms_dest')) || null
};

// Utilities
export function getWindDir(d) {
  if (d === null) return '—';
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(d/45)%8];
}

export function getDistKm(a, b, c, d){
  const R = 6371;
  const dA = (c - a) * Math.PI / 180;
  const dB = (d - b) * Math.PI / 180;
  const x = Math.sin(dA/2)**2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dB/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function toKph(ms){
  return ms ? ms * 3.6 : 0;
}