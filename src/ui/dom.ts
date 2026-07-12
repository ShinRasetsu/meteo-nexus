// ============================================================
// METEONEXUS - UI: DOM REFERENCES
// ============================================================

export const DOM = {
  maxSpeed: document.getElementById('max-speed'),
  liveSpeed: document.getElementById('live-speed'),
  liveHeadingDeg: document.getElementById('live-heading-deg'),
  liveHeadingTxt: document.getElementById('live-heading-txt'),
  liveCompassIcon: document.getElementById('live-compass-icon'),
  hudMap: document.getElementById('hud-map'),
  accUi: document.getElementById('gps-acc-ui'),
  statusEl: document.getElementById('route-status'),
  navBtn: document.getElementById('native-nav-btn'),
  timelineContainer: document.getElementById('timeline-container'),
  localTimeText: document.getElementById('local-time-text'),
  locationBadge: document.getElementById('location-badge'),
  metricTemp: document.getElementById('metric-temp'),
  metricFeels: document.getElementById('metric-feels'),
  metricTempSpread: document.getElementById('metric-temp-spread'),
  metricHum: document.getElementById('metric-hum'),
  metricAgree: document.getElementById('metric-agree'),
  codeAgreementBadge: document.getElementById('code-agreement-badge'),
  metricWindSpeed: document.getElementById('metric-wind-speed'),
  metricWindDir: document.getElementById('metric-wind-dir'),
  metricUvVal: document.getElementById('metric-uv-val'),
  metricUvTime: document.getElementById('metric-uv-time'),
  weatherDesc: document.getElementById('weather-desc'),
  mainCard: document.getElementById('main-status-card'),
  statusIcon: document.getElementById('status-icon'),
  statusText: document.getElementById('status-text'),
  tacticalBtn: document.getElementById('tactical-btn'),
  gmapsPasteBtn: document.getElementById('gmaps-paste-btn'),
  secMap: document.getElementById('sec-map'),
  secTelemetry: document.getElementById('sec-telemetry'),
  secIntel: document.getElementById('sec-intel'),
  secPlot: document.getElementById('sec-plot'),
  modals: {
    custom: document.getElementById('custom-modal'),
    mapCache: document.getElementById('map-cache-modal'),
    mapClear: document.getElementById('map-clear-modal'),
    fuelSettings: document.getElementById('fuel-settings-modal')
  },
  fuel: {
    trigger: document.getElementById('fuel-trigger-btn'),
    save: document.getElementById('save-fuel-btn'),
    brand: document.getElementById('pref-brand'),
    variant: document.getElementById('pref-variant'),
    toll: document.getElementById('pref-toll'),
    highway: document.getElementById('pref-highway'),
    ferry: document.getElementById('pref-ferry')
  },
  audio: {
    btn: document.getElementById('audio-btn'),
    icon: document.getElementById('audio-icon'),
    text: document.getElementById('audio-text')
  },
  cacheMapBtn: document.getElementById('cache-map-btn')
};

export function updateText(el: HTMLElement | null, val: string | number): void {
  if (el && el.textContent !== String(val)) el.textContent = String(val);
}

export function updateHTML(el: HTMLElement | null, val: string): void {
  if (el && el.innerHTML !== val) el.innerHTML = val;
}

export function updateClass(el: HTMLElement | null, val: string): void {
  if (el && el.className !== val) el.className = val;
}