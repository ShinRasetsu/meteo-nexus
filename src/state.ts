// ============================================================
// METEONEXUS - STATE STORE (Single Source of Truth)
// ============================================================

export interface Coords { lat: number; lon: number; }

export interface RouteNode {
  lat: number;
  lon: number;
  id: number;
  passed: boolean;
  distKm?: string;
  nodeRef?: HTMLElement;
}

export interface CoreState {
  gnssHeading: number | null;
  speed: number;
  altitude: number | null;
  topoAltitude: number | null;
  windDir: number | null;
  windSpeed: number;
  windGust: number;
  lastGnssUpdate: number;
  fusedHeading: number | null;
  gpsAccuracy: number | null;
  deviceHeading: number | null;
  quaternionActive: boolean;
  pitch: number;
  roll: number;
}

export const coreState: CoreState = {
  gnssHeading: null,
  speed: 0,
  altitude: null,
  topoAltitude: null,
  windDir: null,
  windSpeed: 0,
  windGust: 0,
  lastGnssUpdate: 0,
  fusedHeading: null,
  gpsAccuracy: null,
  deviceHeading: null,
  quaternionActive: false,
  pitch: 0,
  roll: 0
};

export interface AppState {
  mode: 'auto' | 'manual';
  autoCoords: Coords | null;
  targetCoords: Coords | null;
  coords: Coords | null;
  visual: { lat: number | null; lon: number | null; heading: number | null };
  isMapLocked: boolean;
  lastHudLat: number;
  lastHudLon: number;
  cumulativeHeading: number;
  lastHeading: number;
  currentSpeed: number;
  smoothedSpeed: number | null;
  sensorHeading: number | null;
  rawSensorHeading: number | null;
  maxSpeed: number;
  routeNodes: { lat: number; lon: number; id: number; passed: boolean }[] | null;
  originalRouteNodes: { lat: number; lon: number; id: number; passed: boolean }[] | null;
  targetTimezone: string | null;
  chart: any | null;
  audioEnabled: boolean;
  lastPing: number;
  mapObj: any | null;
  routeCtrl: any | null;
  gpsWatchId: number | null;
  userMarker: any | null;
  interceptMarkers: any[];
  userAuth: any | null;
  lastIntelFetch: number;
  intelFetchAbortController: AbortController | null;
  tacticalMode: number;
  scaleCtrl: any | null;
  currentRouteCoords: L.LatLng[] | null;
  focusedSection: string | null;
  lastSpeedTimestamp: number;
  lastLocationTimestamp: number;
  telemetryCache: { timestamp: number; lat: number; lon: number };
  lastFetchAttempt: number;
  isCachingMap: boolean;
  mapAbortController: AbortController | null;
  fuelMarkers: any[];
  isFuelOnlyRoute: boolean;
  customRouteWaypoints: L.LatLng[] | null;
  timelineIdleTimer: number | null;
  renderPending: boolean;
  renderAccuracy: number | null;
  renderSpeed: number | null;
  renderHeading: number | null;
  renderAccText: string | null;
  renderAccClass: string | null;
}

export const state: AppState = {
  mode: 'auto',
  autoCoords: null,
  targetCoords: null,
  coords: {},
  visual: { lat: null, lon: null, heading: null },
  isMapLocked: true,
  lastHudLat: 0,
  lastHudLon: 0,
  cumulativeHeading: 0,
  lastHeading: 0,
  currentSpeed: 0,
  smoothedSpeed: null,
  sensorHeading: null,
  rawSensorHeading: null,
  maxSpeed: 0,
  routeNodes: null,
  originalRouteNodes: null,
  targetTimezone: null,
  chart: null,
  audioEnabled: false,
  lastPing: 0,
  mapObj: null,
  routeCtrl: null,
  gpsWatchId: null,
  userMarker: null,
  interceptMarkers: [],
  userAuth: null,
  lastIntelFetch: 0,
  intelFetchAbortController: null,
  tacticalMode: 1,
  scaleCtrl: null,
  currentRouteCoords: null,
  focusedSection: null,
  lastSpeedTimestamp: 0,
  lastLocationTimestamp: 0,
  telemetryCache: { timestamp: 0, lat: 0, lon: 0 },
  lastFetchAttempt: 0,
  isCachingMap: false,
  mapAbortController: null,
  fuelMarkers: [],
  isFuelOnlyRoute: false,
  customRouteWaypoints: null,
  timelineIdleTimer: null,
  renderPending: false,
  renderAccuracy: null,
  renderSpeed: null,
  renderHeading: null,
  renderAccText: null,
  renderAccClass: null
};

// Re-export for compatibility
export const __METEO_CORE_STATE = coreState;