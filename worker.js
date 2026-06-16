"use strict";

// --- HIGH-PERFORMANCE MATH KERNEL ---
// Duplicated here because Web Workers do not share the main thread's scope.
function fastDistance(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295; 
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p)/2 + 
              c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
    return 12742000 * Math.asin(Math.sqrt(a)); 
}

// --- VALHALLA DECODER (ZERO-ALLOCATION POLYLINE DECOMPRESSION) ---
function decodeValhallaPolyline(str) {
    let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null;
    const factor = 1e6; // Valhalla strictly uses 6 digits of precision
    while (index < str.length) {
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
        
        // Return raw object. Leaflet instances cannot pass the Worker boundary.
        coordinates.push({ lat: lat / factor, lng: lng / factor });
    }
    return coordinates;
}

// --- ROUTE NODE CALCULATOR ---
function calculateRouteNodes(totalDistance, coords, intervalDist) {
    if (!coords || coords.length === 0) return [];

    const totalFutureNodesCount = Math.floor(totalDistance / intervalDist); 
    const nodes = new Array(totalFutureNodesCount);
    
    let cumulativeDistances = new Float32Array(coords.length);
    cumulativeDistances[0] = 0;
    for (let j = 1; j < coords.length; j++) {
        const lonPrev = coords[j-1].lng !== undefined ? coords[j-1].lng : coords[j-1].lon;
        const lonCurr = coords[j].lng !== undefined ? coords[j].lng : coords[j].lon;
        cumulativeDistances[j] = cumulativeDistances[j-1] + fastDistance(coords[j-1].lat, lonPrev, coords[j].lat, lonCurr);
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
            const lon1 = p1.lng !== undefined ? p1.lng : p1.lon;
            const lon2 = p2.lng !== undefined ? p2.lng : p2.lon;
            
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
    
    // Zero-allocation truncation: Avoids `.filter()` overhead and prevents GC pauses
    nodes.length = validNodeCount;
    return nodes;
}

// --- OVERPASS API PAYLOAD PARSER ---
function processOverpassPayload(data, lat, lon, targetBrand, targetVariant, variantMap) {
    if (!data.elements || data.elements.length === 0) return { stations: [], isStrict: false };
    
    let results = new Map();
    let exactMatchesCount = 0;
    const reqOsmTag = variantMap[targetVariant];

    for (let i = 0; i < data.elements.length; i++) {
        const el = data.elements[i];
        const tLat = el.lat || el.center.lat; 
        const tLon = el.lon || el.center.lon;
        
        // 53-bit Safe Integer hashing algorithm to completely avoid string allocation GC spikes.
        // Projects -90/90 to 0/1.8M and -180/180 to 0/3.6M, combining into a single integer.
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
        // In-place pointer shifting to avoid creating a new array via .filter()
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
        // Explicitly extract the stack trace back to the main thread for deterministic debugging
        self.postMessage({ messageId, error: error.message, stack: error.stack });
    }
};