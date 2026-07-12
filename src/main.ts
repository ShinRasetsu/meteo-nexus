// ============================================================
// METEONEXUS - MAIN ENTRY POINT
// ============================================================

import { state, coreState } from './state.js';
import { CONFIG } from './config.js';
import { WeatherEnsemble, ensemble } from './ensemble/ensemble.js';
import { SmartRouter } from './router/smartRouter.js';
import { FuelManager } from './fuel/fuelManager.js';
import { renderAeroHud, handleOrientationUpdate } from './aero/render.js';
import { mountActiveAeroUI } from './aero/mount.js';
import { initMap, updateRouteStatus, resetToAuto, activateLiveNavigation } from './ui/map.js';
import { processTelemetryPayload, fetchData } from './ui/telemetry.js';
import { renderChart } from './ui/chart.js';
import { updateInterceptMarkersPool } from './ui/intel.js';
import { renderRouteIntelTimeline, fetchRouteIntelligence } from './ui/routeIntel.js';

// Global references for compatibility
(window as any).__METEO_CORE_STATE = coreState;
(window as any).WeatherEnsemble = WeatherEnsemble;
(window as any).ensemble = ensemble;
(window as any).CONFIG = CONFIG;
(window as any).SmartRouter = SmartRouter;
(window as any).FuelManager = FuelManager;
(window as any).fastDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
  return 12742000 * Math.asin(Math.sqrt(a));
};

// Expose globals for HTML inline handlers
(window as any).toggleFocus = (secId: string) => import('./ui/focus.js').then(m => m.toggleFocus(secId));
(window as any).toggleAudio = () => import('./ui/audio.js').then(m => m.toggleAudio());
(window as any).toggleTacticalMode = () => import('./ui/tactical.js').then(m => m.toggleTacticalMode());
(window as any).resetToAuto = resetToAuto;
(window as any).activateLiveNavigation = activateLiveNavigation;
(window as any).handlePasteAndLoad = () => import('./ui/clipboard.js').then(m => m.handlePasteAndLoad());
(window as any).purgeSystem = () => import('./ui/purge.js').then(m => m.purgeSystem());
(window as any).executePurge = () => import('./ui/purge.js').then(m => m.executePurge());
(window as any).executeMapCache = () => import('./ui/mapCache.js').then(m => m.executeMapCache());
(window as any).executeMapClear = () => import('./ui/mapCache.js').then(m => m.executeMapClear());
(window as any).closeModal = (id: string) => document.getElementById(id)?.classList.add('hidden');
(window as any).getWindDirection = (deg: number) => {
  const arr = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return arr[Math.floor((deg / 22.5) + 0.5) % 16];
};

async function runApp() {
  // Initialize modules
  const fuelManager = new FuelManager();
  await fuelManager.loadConfig();

  // Start GPS tracking
  import('./gps.js').then(m => m.startBackgroundTracking());

  // Start render loops
  requestAnimationFrame(renderAeroHud);
  import('./ui/visuals.js').then(m => m.smoothVisualsLoop());

  // Initialize map
  if (state.autoCoords) {
    await import('./ui/map.js').then(m => m.initMap(state.autoCoords!.lat, state.autoCoords!.lon));
    fetchData(state.autoCoords.lat, state.autoCoords.lon, false);
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => { state.autoCoords = { lat: p.coords.latitude, lon: p.coords.longitude }; import('./ui/map.js').then(m => m.initMap(p.coords.latitude, p.coords.longitude)); fetchData(p.coords.latitude, p.coords.longitude, false); },
      () => { /* GPS blocked UI */ },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // PWA registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' });
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runApp);
} else {
  runApp();
}

// Expose for inline handlers
(window as any).reportRoutingFallback = () => import('./ui/map.js').then(m => m.reportRoutingFallback());
(window as any).updateRouteStatus = updateRouteStatus;
(window as any).activateLiveNavigation = activateLiveNavigation;
(window as any).resetToAuto = resetToAuto;
(window as any).fetchRouteIntelligence = fetchRouteIntelligence;
(window as any).renderRouteIntelTimeline = renderRouteIntelTimeline;
(window as any).renderChart = renderChart;
(window as any).processTelemetryPayload = processTelemetryPayload;
(window as any).fetchData = fetchData;
(window as any).updateInterceptMarkersPool = updateInterceptMarkersPool;