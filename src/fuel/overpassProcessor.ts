// ============================================================
// METEONEXUS - OVERPASS PROCESSOR
// ============================================================

import { VARIANT_OSM_MAP } from './fuelCatalog.js';
import { fastDistance } from '../utils/math.js';

export function processOverpassPayload(
  data: any,
  lat: number,
  lon: number,
  targetBrand: string,
  targetVariant: string,
  variantMap: Record<string, string>
): { stations: any[]; isStrict: boolean } {
  if (!data.elements || data.elements.length === 0) return { stations: [], isStrict: false };

  let results = new Map<number, any>();
  let exactMatchesCount = 0;
  const reqOsmTag = variantMap[targetVariant];

  for (let i = 0; i < data.elements.length; i++) {
    const el = data.elements[i];
    const tLat = el.lat || el.center.lat;
    const tLon = el.lon || el.center.lon;

    // 53-bit Safe Integer hashing algorithm to completely avoid string allocation GC spikes
    const idInt = ((Math.round(tLat * 10000) + 900000) * 10000000) + (Math.round(tLon * 10000) + 1800000);

    if (!results.has(idInt)) {
      const d = fastDistance(lat, lon, tLat, tLon);
      let isExact = false;

      if (reqOsmTag && el.tags && el.tags[reqOsmTag] === 'yes') {
        isExact = true;
        exactMatchesCount++;
      }

      results.set(idInt, {
        lat: tLat, lon: tLon,
        name: el.tags && el.tags.name ? el.tags.name : targetBrand,
        dist: (d/1000).toFixed(1),
        isExact: isExact
      });
    }
  }

  let finalArray = Array.from(results.values());
  let isStrictFiltered = false;

  // Tier 1 Enforcer: If OSM contains exact tag matches, filter strictly
  if (exactMatchesCount > 0 && reqOsmTag) {
    let keepIdx = 0;
    for (let i = 0; i < finalArray.length; i++) {
      if (finalArray[i].isExact) {
        finalArray[keepIdx++] = finalArray[i];
      }
    }
    finalArray.length = keepIdx;
    isStrictFiltered = true;
  }

  finalArray.sort((a,b) => parseFloat(a.dist) - parseFloat(b.dist));

  for (let i = 0; i < finalArray.length; i++) {
    finalArray[i].strictFilterActive = isStrictFiltered;
  }

  return { stations: finalArray, isStrict: isStrictFiltered };
}