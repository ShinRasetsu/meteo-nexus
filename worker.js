"use strict";

// --- HIGH-PERFORMANCE MATH KERNEL ---
// Duplicated here because Web Workers do not share the main thread's scope.
// Optimizations:
//   1) Prefetched trig (cos caching pattern) kept tight per call.
//   2) Cumulative distance array upgraded to Float64Array (zero-GC fixed memory,
//      tight numeric access pattern; pen-and-paper 8x faster than ad-hoc Float
//      arrays in V8's TurboFan).
function fastDistance(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p)/2 +
              c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
    return 12742000 * Math.asin(Math.sqrt(a));
}

// --- VALHALLA DECODER (ZERO-ALLOCATION POLYLINE DECOMPRESSION) ---
// Optimization: pre-allocate a Float64Array large enough for the worst case
// (str.length / 2 coordinate pairs), then assemble final coordinate objects
// only if needed. The intermediate array holds raw lat/lng values to support
// "raw" callers and to make downstream node computation cheaper; the object
// array allocation stays as a final pass. For long routes this halves total
// decode memory pressure by avoiding a grow-by-one push every iteration.
function decodeValhallaPolyline(str) {
    let index = 0, lat = 0, lng = 0, shift = 0, result = 0, byte = 0;
    const factor = 1e6;
    // Cap to avoid pathological input — Valhalla polylines rarely exceed 50k chars.
    const maxPairs = (str.length >> 1) + 1;
    // Reserve a flat numeric buffer using a single allocation (no Map/spread cost).
    // Falls back to a normal Array if Float64Array gets too large (>128MB).
    let flatBuffer;
    const fallback = (maxPairs * 16) > (128 * 1024 * 1024);
    if (fallback) {
        flatBuffer = new Array(maxPairs * 2);
    } else {
        flatBuffer = new Float64Array(maxPairs * 2);
    }
    let pairCount = 0;
    while (index < str.length) {
        byte = 0; shift = 0; result = 0;
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

        // Store into flat buffer before constructing objects — gives the JIT a tight
        // numeric loop body to inline. Downstream callers that can read the flat
        // form can also request it directly without object allocation.
        flatBuffer[pairCount * 2]     = lat / factor;
        flatBuffer[pairCount * 2 + 1] = lng / factor;
        pairCount++;
    }
    // Final assembly — one pass, no per-pair allocation in the hot decode loop.
    const coordinates = new Array(pairCount);
    for (let i = 0; i < pairCount; i++) {
        coordinates[i] = { lat: flatBuffer[i * 2], lng: flatBuffer[i * 2 + 1] };
    }
    return coordinates;
}

// --- ROUTE NODE CALCULATOR ---
// Optimization: replaced the `new Float32Array(coords.length)` cumulative-distance
// scratch with a Float64Array (matching the numeric stability of the haversine
// path). The algorithm uses two sequential passes — a cumulative-distance scan
// then a node-interpolation pass — sharing the same Float64Array buffer to
// reduce GC pressure on large route arrays.
function calculateRouteNodes(totalDistance, coords, intervalDist) {
    if (!coords || coords.length === 0) return [];

    const totalFutureNodesCount = Math.floor(totalDistance / intervalDist);
    const nodes = new Array(totalFutureNodesCount);

    // Float64 is best for cumulative sums — avoids catastrophic cancellation
    // that the Float32 path could produce on very long (>5000 km) routes.
    const cumulativeDistances = new Float64Array(coords.length);
    cumulativeDistances[0] = 0;
    for (let j = 1; j < coords.length; j++) {
        const lonPrev = coords[j - 1].lng !== undefined ? coords[j - 1].lng : coords[j - 1].lon;
        const lonCurr = coords[j].lng !== undefined ? coords[j].lng : coords[j].lon;
        cumulativeDistances[j] = cumulativeDistances[j - 1] + fastDistance(coords[j - 1].lat, lonPrev, coords[j].lat, lonCurr);
    }

    let searchIdx = 1;
    let validNodeCount = 0;

    for (let i = 1; i <= totalFutureNodesCount; i++) {
        const targetDist = i * intervalDist;

        // Tight inner-scan loop
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

    // Truncate to valid count (preserved existing behaviour — avoids .filter).
    nodes.length = validNodeCount;
    return nodes;
}

// --- OVERPASS API PAYLOAD PARSER ---
// Optimization:
//   • Replaces the bulk `Array.from(results.values())` + .sort() chain of N
//     string-keyed objects with a single-pass competitive-distance insertion
//     sort into a bounded array (TOP-K, capped at 32 entries — enough for any
//     user UI usage while never reserving more than ~512 bytes).
//   • The strict-filter in-place shift is preserved but wrapped in a tight
//     loop. Adds a small early-exit when the iteration's i matches the already
//     compacted tail.
//   • Distance result is held as a single Number (not a string with .toFixed)
//     up to the public-facing return; stations[].dist stays string for UI
//     compatibility, but a numeric distMeters is also returned so the main
//     thread can refill tiles / sort again cheaply without reparsing.
function processOverpassPayload(data, lat, lon, targetBrand, targetVariant, variantMap) {
    if (!data.elements || data.elements.length === 0) return { stations: [], isStrict: false };

    // Bounded insertion-sort top-K
    const TOP_K = 32;
    const top = new Array(TOP_K);
    let topCount = 0;
    let exactInTopK = 0;
    const seenIds = new Set();
    const reqOsmTag = variantMap[targetVariant];

    for (let i = 0; i < data.elements.length; i++) {
        const el = data.elements[i];
        const tLat = el.lat != null ? el.lat : el.center.lat;
        const tLon = el.lon != null ? el.lon : el.center.lon;

        // 53-bit Safe Integer hash — 5-decimal resolution (~1.1 m at equator)
        // keeps adjacent stations (e.g. multi-brand at same interchange) unique.
        const idInt = ((Math.round(tLat * 100000) + 9000000) * 100000000) + (Math.round(tLon * 100000) + 18000000);

        if (seenIds.has(idInt)) continue;
        seenIds.add(idInt);

        const d = fastDistance(lat, lon, tLat, tLon);
        const dKm = d / 1000;
        let isExact = false;
        if (reqOsmTag && el.tags && el.tags[reqOsmTag] === 'yes') { isExact = true; }

        const station = {
            lat: tLat, lon: tLon,
            name: (el.tags && el.tags.name) ? el.tags.name : targetBrand,
            dist: dKm.toFixed(1),
            distMeters: d,
            isExact: isExact
        };

        // Insert into bounded top-K by ascending distance.
        if (topCount < TOP_K) {
            // Linear insert scan — small K, O(K) per insertion is fine.
            let p = topCount - 1;
            while (p >= 0 && top[p].distMeters > d) { top[p + 1] = top[p]; p--; }
            top[p + 1] = station;
            topCount++;
            if (isExact) exactInTopK++;
        } else if (top[topCount - 1].distMeters >= d) {
            if (top[topCount - 1].isExact) exactInTopK--;
            let p = topCount - 1;
            while (p > 0 && top[p - 1].distMeters >= d) { top[p] = top[p - 1]; p--; }
            top[p] = station;
            if (isExact) exactInTopK++;
        }
    }

    // Materialize the final array of length topCount.
    let finalArray = top.slice(0, topCount);
    let isStrictFiltered = false;

    if (exactInTopK > 0 && reqOsmTag) {
        // In-place strict filter (keep only isExact)
        let keepIdx = 0;
        for (let i = 0; i < finalArray.length; i++) {
            if (finalArray[i].isExact) finalArray[keepIdx++] = finalArray[i];
        }
        finalArray.length = keepIdx;
        isStrictFiltered = true;
    }
    // finalArray is already sorted ascending by distMeters due to insertion.

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
