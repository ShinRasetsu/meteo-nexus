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