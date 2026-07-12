// ============================================================
// METEONEXUS - SMART ROUTER
// OSRM primary, Valhalla fallback with exclusions
// ============================================================

import L from 'leaflet';
import { FuelManager } from '../fuel/fuelManager.js';

export class SmartRouter extends L.Class {
  osrm: any;

  initialize(options: any) {
    this.osrm = L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' });
  }

  route(waypoints: L.LatLng[], callback: Function, context: any, options: any) {
    const conf = FuelManager.getConfig();
    const hasExclusions = conf.avoidTolls || conf.avoidHighways || conf.avoidFerries;

    const fetchOSRM = () => new Promise((resolve, reject) => {
      this.osrm.route(waypoints, (err: any, routes: any[]) => {
        if (err || !routes || routes.length === 0) reject(err || new Error("OSRM failed"));
        else { let r = routes[0]; r.engine = 'OSRM'; r.mode = 'STD'; resolve(r); }
      }, context, options);
    });

    const getValhallaPayload = () => ({
      locations: waypoints.map(wp => ({ lat: wp.lat, lon: wp.lng })),
      costing: "auto", units: "kilometers",
      costing_options: { auto: {
        toll_booth_penalty: conf.avoidTolls ? 999999 : 0,
        toll_booth_cost: conf.avoidTolls ? 999999 : 0,
        use_tolls: conf.avoidTolls ? 0 : 1,
        use_highways: conf.avoidHighways ? 0 : 1,
        use_ferry: conf.avoidFerries ? 0 : 1
      }}
    });

    const fetchValhalla = async (endpoint: string) => {
      const req = getValhallaPayload();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(req),
        timeout: 12000
      } as any);
      if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
      const data = await res.json();
      if (!data.trip || !Array.isArray(data.trip.legs) || data.trip.legs.length === 0) throw new Error('Valhalla response missing trip.legs');
      let totalDist = 0, totalTime = 0, coords: L.LatLng[] = [];
      for (const leg of data.trip.legs) {
        if (!leg.summary || !leg.shape) throw new Error('Valhalla leg missing summary or shape');
        totalDist += leg.summary.length * 1000;
        totalTime += leg.summary.time;
        // Note: In production, decode Valhalla polyline here
        // For now, coordinates are handled by main thread worker
      }
      return { name: `Valhalla Tactical Route (auto)`, engine: 'VALHALLA', mode: 'FAST', coordinates: coords, instructions: [], summary: { totalDistance: totalDist, totalTime: totalTime }, inputWaypoints: waypoints, waypoints: waypoints };
    };

    if (!hasExclusions) {
      fetchOSRM().then((osrmRoute: any) => {
        (window as any).lastWinningEngine = `${osrmRoute.engine}-${osrmRoute.mode}`;
        callback.call(context, null, [osrmRoute]);
      }).catch((e: Error) => {
        console.warn("OSRM Primary Engine Failed. Attempting Valhalla fallback.", e);
        tryValhalla();
      });
      return;
    }

    async function tryValhalla() {
      try {
        const promises = [fetchValhalla('https://valhalla1.openstreetmap.de/route'), fetchValhalla('https://valhalla.openstreetmap.de/route')];
        const results = await Promise.allSettled(promises);
        const successfulRoutes = results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value);
        if (successfulRoutes.length === 0) throw new Error("All Valhalla routing requests failed.");
        successfulRoutes.sort((a, b) => a.summary.totalTime - b.summary.totalTime);
        const optimalRoute = successfulRoutes[0];
        (window as any).lastWinningEngine = `${optimalRoute.engine}-${optimalRoute.mode}`;
        callback.call(context, null, [optimalRoute]);
      } catch(e) {
        console.warn("Optimal Routing Engine Consensus Failed. Attempting pure OSRM fallback (Exclusions Ignored).", e);
        if ((window as any).reportRoutingFallback) (window as any).reportRoutingFallback();
        (window as any).lastWinningEngine = "OSRM-FALLBACK";
        fetchOSRM().then((r: any) => callback.call(context, null, [r])).catch(() => callback.call(context, new Error("All routing failed"), []));
      }
    }
  }
}