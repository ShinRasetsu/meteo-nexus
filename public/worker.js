"use strict";

// ============================================================
// METEONEXUS - WORKER ENTRY POINT
// ============================================================

import { fastDistance } from '../src/utils/math.js';
import { calculateRouteNodes } from '../src/router/routeNodes.js';
import { decodeValhallaPolyline } from '../src/router/valhallaDecoder.js';
import { processOverpassPayload } from '../src/fuel/overpassProcessor.js';
import { VARIANT_OSM_MAP } from '../src/fuel/fuelCatalog.js';

// --- WORKER MESSAGE DISPATCHER ---
self.onmessage = function(e) {
  const { type, messageId, payload } = e.data;
  try {
    let result;
    switch(type) {
      case 'DECODE_VALHALLA':
        result = decodeValhallaPolyline(payload.shape);
        break;
      case 'CALCULATE_NODES':
        result = calculateRouteNodes(payload.totalDistance, payload.coords, payload.intervalDist);
        break;
      case 'PROCESS_OVERPASS':
        result = processOverpassPayload(
          payload.data, payload.lat, payload.lon, 
          payload.targetBrand, payload.targetVariant, payload.variantMap
        );
        break;
      default:
        throw new Error("Unknown worker task vector: " + type);
    }
    self.postMessage({ messageId, result });
  } catch (error) {
    self.postMessage({ messageId, error: error.message, stack: error.stack });
  }
};