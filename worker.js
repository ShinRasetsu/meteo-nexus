"use strict";

// --- GLOBAL MATH CONSTANTS ---
const RAD_CONV = 0.017453292519943295; // Math.PI / 180
const EARTH_DIA = 12742000;            // Earth Radius * 2 in meters

// --- HIGH-PERFORMANCE MATH KERNEL ---
// Duplicated here because Web Workers do not share the main thread's scope.
// Optimized with cosLat1 invariant injection to bypass redundant O(N) trig overhead
function fastDistance(lat1, lon1, lat2, lon2, cosLat1) {
    const c = Math.cos;
    const cl1 = cosLat1 !== undefined ? cosLat1 : c(lat1 * RAD_CONV);
    const a = 0.5 - c((lat2 - lat1) * RAD_CONV)/2 + 
              cl1 * c(lat2 * RAD_CONV) * (1 - c((lon2 - lon1) * RAD_CONV))/2;
    // Strict domain clamping prevents Float64 inaccuracies from yielding NaN in Math.asin
    return EARTH_DIA * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a)))); 
}

// --- VALHALLA DECODER (ZERO-ALLOCATION POLYLINE DECOMPRESSION) ---
function decodeValhallaPolyline(str) {
    let index = 0, lat = 0, lng = 0, shift = 0, result = 0, byte = null;
    const factor = 1e6; // Valhalla strictly uses 6 digits of precision
    const len = str.length;
    
    // Pre-allocate maximum theoretical memory bounds to prevent V8 dynamic array resizing
    const coordinates = new Array(len); 
    let coordIdx = 0;

    while (index < len) {
        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
        
        shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
        
        // Direct index assignment bypasses .push() GC overhead
        coordinates[coordIdx++] = { lat: lat / factor, lng: lng / factor };
    }
    
    // Zero-allocation truncation drops unused pre-allocated indices safely
    coordinates.length = coordIdx;
    return coordinates;
}

// --- ROUTE NODE CALCULATOR ---
function calculateRouteNodes(totalDistance, coords, intervalDist) {
    // Spatial bounds guard: prevents RangeError (Infinity Array) and logical crashes
    if (!coords || coords.length < 2 || intervalDist <= 0) return [];

    const totalFutureNodesCount = Math.floor(totalDistance / intervalDist); 
    const nodes = new Array(totalFutureNodesCount);
    
    // Float64Array enforces double precision to prevent sub-meter drift on routes >100km
    let cumulativeDistances = new Float64Array(coords.length);
    cumulativeDistances[0] = 0;
    
    // Cache references outside the loop to eliminate redundant array lookups
    let prev = coords[0];
    let prevLon = prev.lng ?? prev.lon;
    let prevLat = prev.lat;
    
    // Sliding window trigonometric cache halves Math.cos operations during traversal
    let prevCosLat = Math.cos(prevLat * RAD_CONV);
    
    for (let j = 1; j < coords.length; j++) {
        const curr = coords[j];
        const currLon = curr.lng ?? curr.lon;
        const currLat = curr.lat;
        
        cumulativeDistances[j] = cumulativeDistances[j-1] + fastDistance(prevLat, prevLon, currLat, currLon, prevCosLat);
        
        prevLat = currLat;
        prevLon = currLon;
        prevCosLat = Math.cos(currLat * RAD_CONV); // Shift window forward
    }

    let searchIdx = 1;
    let validNodeCount = 0;

    for (let i = 1; i <= totalFutureNodesCount; i++) {
        const targetDist = i * intervalDist;
        
        while (searchIdx < coords.length && cumulativeDistances[searchIdx] < targetDist) {
            searchIdx++;
        }

        if (searchIdx < coords.length) {
            const p1 = coords[searchIdx - 1];
            const p2 = coords[searchIdx];
            const lon1 = p1.lng ?? p1.lon;
            const lon2 = p2.lng ?? p2.lon;
            
            const segmentDist = cumulativeDistances[searchIdx] - cumulativeDistances[searchIdx - 1];
            const excessDist = targetDist - cumulativeDistances[searchIdx - 1];
            const ratio = segmentDist === 0 ? 0 : excessDist / segmentDist;

            nodes[validNodeCount++] = {
                lat: p1.lat + (p2.lat - p1.lat) * ratio,
                lon: lon1 + (lon2 - lon1) * ratio,
                id: i,
                passed: false
            };
        }
    }
    
    nodes.length = validNodeCount;
    return nodes;
}

// --- OVERPASS API PAYLOAD PARSER ---
function processOverpassPayload(data, lat, lon, targetBrand, targetVariant, variantMap) {
    if (!data.elements || data.elements.length === 0) return { stations: [], isStrict: false };
    
    let results = new Map();
    let exactMatchesCount = 0;
    
    // Optional chaining prevents TypeError crash if variantMap is undefined in payload
    const reqOsmTag = variantMap?.[targetVariant];
    
    // Extract invariant trigonometry to prevent O(N) recalculation during map scan
    const userCosLat = Math.cos(lat * RAD_CONV);

    for (let i = 0; i < data.elements.length; i++) {
        const el = data.elements[i];
        
        // Safely extract coordinates, falling back to center node for ways/relations
        const tLat = el.lat ?? el.center?.lat; 
        const tLon = el.lon ?? el.center?.lon;
        
        // Structural validation guard to prevent NaN poisoning in fastDistance
        if (tLat == null || tLon == null) continue;
        
        // Native identity implementation prevents overlapping node collisions
        const idKey = el.type ? el.type + el.id : el.id;
        
        if (!results.has(idKey)) {
            // Inject invariant to bypass redundant Math.cos overhead
            const d = fastDistance(lat, lon, tLat, tLon, userCosLat);
            let isExact = false;
            
            if (reqOsmTag && el.tags && el.tags[reqOsmTag] === 'yes') {
                isExact = true;
                exactMatchesCount++;
            }
            
            results.set(idKey, { 
                lat: tLat, lon: tLon, 
                name: el.tags?.name ?? targetBrand, // Optimized fallback assignment
                dist: (d/1000).toFixed(1),
                rawDist: d,
                isExact: isExact
            });
        }
    }
    
    // Pre-allocated array prevents intermediate Iterator allocations during GC cycles
    const finalArray = new Array(results.size);
    let iterIdx = 0;
    for (const val of results.values()) {
        finalArray[iterIdx++] = val;
    }
    
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
    
    // Extracted parse iteration overhead by comparing native numeric state
    finalArray.sort((a,b) => a.rawDist - b.rawDist);
    
    for (let i = 0; i < finalArray.length; i++) {
        finalArray[i].strictFilterActive = isStrictFiltered;
    }
    
    return { stations: finalArray, isStrict: isStrictFiltered };
}

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