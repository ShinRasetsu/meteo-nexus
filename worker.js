"use strict";

// --- WEATHER ENSEMBLE (duplicated for worker scope) ---
const ENSEMBLE_WEIGHTS = {
    ecmwf_ifs025: 0.35,
    gfs_seamless: 0.35,
    icon_seamless: 0.15,
    jma_seamless: 0.15
};
const ENSEMBLE_LABELS = { ecmwf_ifs025: 'EU', gfs_seamless: 'US', icon_seamless: 'DE', jma_seamless: 'JP' };
const ENSEMBLE_MODELS = Object.keys(ENSEMBLE_WEIGHTS);
const WET_THRESHOLD_MM = 0.1;
const WET_POSSIBLE_PCT = 40;
const WET_LIKELY_PCT = 75;
const HEALTH_DEGRADED_PCT = 80;
const HEALTH_DOWN_PCT = 20;

const WeatherEnsembleWorker = {
    models: ENSEMBLE_MODELS,
    weights: ENSEMBLE_WEIGHTS,
    labels: ENSEMBLE_LABELS,
    WET_THRESHOLD_MM,
    WET_POSSIBLE_PCT,
    WET_LIKELY_PCT,
    HEALTH_DEGRADED_PCT,
    HEALTH_DOWN_PCT,

    extractModelArrays(hourly, varName) {
        const out = {};
        for (const m of this.models) out[m] = hourly[`${varName}_${m}`] || null;
        return out;
    },

    checkHealth(arr) {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return { healthy: false, coveragePct: 0 };
        let valid = 0;
        for (let i = 0; i < arr.length; i++) { if (arr[i] !== null && arr[i] !== undefined) valid++; }
        const coveragePct = (valid / arr.length) * 100;
        return { healthy: coveragePct >= this.HEALTH_DEGRADED_PCT, coveragePct };
    },

    weightedValueAt(modelArrays, idx) {
        let sum = 0, weightSum = 0, count = 0;
        for (const m of this.models) {
            const v = modelArrays[m] ? modelArrays[m][idx] : null;
            if (v === null || v === undefined) continue;
            const w = this.weights[m];
            sum += v * w; weightSum += w; count++;
        }
        if (count === 0) return { value: null, modelsReporting: 0 };
        return { value: sum / weightSum, modelsReporting: count };
    },

    weightedCircularMeanAt(modelArrays, idx) {
        let sx = 0, sy = 0, weightSum = 0, count = 0;
        for (const m of this.models) {
            const v = modelArrays[m] ? modelArrays[m][idx] : null;
            if (v === null || v === undefined) continue;
            const w = this.weights[m];
            const rad = v * (Math.PI / 180);
            sx += Math.cos(rad) * w; sy += Math.sin(rad) * w;
            weightSum += w; count++;
        }
        if (count === 0) return null;
        let deg = Math.atan2(sy / weightSum, sx / weightSum) * (180 / Math.PI);
        if (deg < 0) deg += 360;
        return deg;
    },

    bandAt(modelArrays, idx) {
        let min = Infinity, max = -Infinity, count = 0;
        for (const m of this.models) {
            const v = modelArrays[m] ? modelArrays[m][idx] : null;
            if (v === null || v === undefined) continue;
            if (v < min) min = v;
            if (v > max) max = v;
            count++;
        }
        if (count === 0) return null;
        return { min, max, spread: max - min };
    },

    weightedWetnessAt(modelArrays, idx) {
        let wetWeight = 0, totalWeight = 0, modelsReporting = 0;
        for (const m of this.models) {
            const v = modelArrays[m] ? modelArrays[m][idx] : null;
            if (v === null || v === undefined) continue;
            const w = this.weights[m];
            totalWeight += w; modelsReporting++;
            if (v > this.WET_THRESHOLD_MM) wetWeight += w;
        }
        if (totalWeight === 0) return { pct: 0, modelsReporting: 0, valid: false };
        return { pct: (wetWeight / totalWeight) * 100, modelsReporting, valid: true };
    },

    // Weighted consensus for categorical fields (WMO weather_code).
    // Returns the code with highest accumulated model weight (not count).
    weightedCodeConsensusAt(modelArrays, idx) {
        const tally = new Map();
        let totalWeight = 0, modelsReporting = 0;
        for (const m of this.models) {
            const v = modelArrays[m] ? modelArrays[m][idx] : null;
            if (v === null || v === undefined) continue;
            const w = this.weights[m];
            const entry = tally.get(v) || { weight: 0, count: 0 };
            entry.weight += w; entry.count += 1;
            tally.set(v, entry);
            totalWeight += w; modelsReporting++;
        }
        if (totalWeight === 0) return { code: null, agreementPct: 0, agreeingCount: 0, modelsReporting: 0 };
        let bestCode = null, bestWeight = -1, bestCount = 0;
        for (const [code, entry] of tally.entries()) {
            if (entry.weight > bestWeight) { bestWeight = entry.weight; bestCode = code; bestCount = entry.count; }
        }
        return { code: bestCode, agreementPct: (bestWeight / totalWeight) * 100, agreeingCount: bestCount, modelsReporting };
    },

    classifyWetness(pct) {
        if (pct >= this.WET_LIKELY_PCT)   return 'RAIN_LIKELY';
        if (pct >= this.WET_POSSIBLE_PCT) return 'RAIN_POSSIBLE';
        return 'STABLE';
    }
};

// --- HIGH-PERFORMANCE MATH KERNEL ---
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
    const factor = 1e6;
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

// --- NORMALIZE TELEMETRY (OFFLOADED FROM MAIN THREAD) ---
function normalizeTelemetryDataWorker(dCurr, dFore, dSolar, isOffline) {
    if (dCurr && dCurr.timezone) {
        // Note: timezone returned in payload but we don't mutate global state from worker
    }
    let curr = dCurr?.current;
    const h    = dFore?.hourly;
    // Fallback: if dSolar missing, use dFore.hourly (ensemble has UV/solar with model suffixes)
    const hSol = dSolar?.hourly || { 
        uv_index: h?.uv_index_ecmwf_ifs025 || [], 
        shortwave_radiation: h?.shortwave_radiation_ecmwf_ifs025 || [] 
    };

    if (!h || !h.time) {
        return { error: 'Missing forecast hourly data' };
    }

    const currentUnixMs = Date.now();
    let nowIndex = 0, minDiff = Infinity;
    h.time.forEach((t, i) => { const diff = Math.abs((t * 1000) - currentUnixMs); if (diff < minDiff) { minDiff = diff; nowIndex = i; } });

    // Extract every model's view of every variable in one pass.
    const tempModels     = WeatherEnsembleWorker.extractModelArrays(h, 'temperature_2m');
    const feelsModels    = WeatherEnsembleWorker.extractModelArrays(h, 'apparent_temperature');
    const humidModels    = WeatherEnsembleWorker.extractModelArrays(h, 'relative_humidity_2m');
    const codeModels     = WeatherEnsembleWorker.extractModelArrays(h, 'weather_code');
    const windSpdModels  = WeatherEnsembleWorker.extractModelArrays(h, 'wind_speed_10m');
    const windDirModels  = WeatherEnsembleWorker.extractModelArrays(h, 'wind_direction_10m');
    const windGustModels = WeatherEnsembleWorker.extractModelArrays(h, 'wind_gusts_10m');
    const precipModels   = WeatherEnsembleWorker.extractModelArrays(h, 'precipitation');

    if (isOffline || !curr) {
        const tBlend   = WeatherEnsembleWorker.weightedValueAt(tempModels, nowIndex);
        const fBlend   = WeatherEnsembleWorker.weightedValueAt(feelsModels, nowIndex);
        const hBlend   = WeatherEnsembleWorker.weightedValueAt(humidModels, nowIndex);
        const wsBlend  = WeatherEnsembleWorker.weightedValueAt(windSpdModels, nowIndex);
        const wdBlend  = WeatherEnsembleWorker.weightedCircularMeanAt(windDirModels, nowIndex);
        const codeBlend = WeatherEnsembleWorker.weightedCodeConsensusAt(codeModels, nowIndex);
        curr = {
            temperature_2m:     tBlend.value  !== null ? tBlend.value  : 0,
            apparent_temperature: fBlend.value !== null ? fBlend.value  : (tBlend.value !== null ? tBlend.value : 0),
            relative_humidity_2m: hBlend.value !== null ? hBlend.value  : 50,
            weather_code:        codeBlend.code !== null ? codeBlend.code : 0,
            wind_speed_10m:      wsBlend.value !== null ? wsBlend.value : 0,
            wind_direction_10m:  wdBlend !== null ? wdBlend : 0,
            is_day: (new Date().getHours() > 6 && new Date().getHours() < 18) ? 1 : 0
        };
    }

    // Coverage-% health per model
    const nodeHealth = WeatherEnsembleWorker.models.map(m => WeatherEnsembleWorker.checkHealth(precipModels[m]));

    // Cosmetic zeroing for chart raw lines only
    const clean = (arr) => {
        const limit = h.time.length;
        const src   = arr || new Array(limit).fill(0);
        const result = new Array(limit);
        for (let i = 0; i < limit; i++) result[i] = src[i] === null ? 0 : src[i];
        return result;
    };
    const rEU = clean(precipModels.ecmwf_ifs025);
    const rUS = clean(precipModels.gfs_seamless);
    const rDE = clean(precipModels.icon_seamless);
    const rJP = clean(precipModels.jma_seamless);

    const maxSlice = Math.min(nowIndex + 24, h.time.length);
    const rainData = { eu: rEU.slice(nowIndex, maxSlice), us: rUS.slice(nowIndex, maxSlice), de: rDE.slice(nowIndex, maxSlice), jp: rJP.slice(nowIndex, maxSlice) };

    const uvArr = hSol.uv_index || new Array(h.time.length).fill(0);
    const uvData = new Array(maxSlice - nowIndex);
    for (let i = 0, j = nowIndex; j < maxSlice; i++, j++) uvData[i] = uvArr[j] === null ? 0 : uvArr[j];
    const solarData = clean(hSol.shortwave_radiation).slice(nowIndex, maxSlice);

    const times = new Array(maxSlice - nowIndex);
    for (let i = 0, j = nowIndex; j < maxSlice; i++, j++) {
        const date = new Date(h.time[j] * 1000);
        const s = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        times[i] = (s === "00:00" || s === "24:00") ? "00:00 (+1d)" : s;
    }

    // Weighted wetness per hour
    const hourlyAgreement = new Array(maxSlice - nowIndex);
    for (let i = 0, j = nowIndex; j < maxSlice; i++, j++) {
        hourlyAgreement[i] = WeatherEnsembleWorker.weightedWetnessAt(precipModels, j).pct;
    }

    // Temperature confidence band
    const tempBand = new Array(maxSlice - nowIndex);
    for (let i = 0, j = nowIndex; j < maxSlice; i++, j++) {
        tempBand[i] = WeatherEnsembleWorker.bandAt(tempModels, j);
    }

    // WMO code consensus at "now"
    const codeAgreement = WeatherEnsembleWorker.weightedCodeConsensusAt(codeModels, nowIndex);

    // Wind ensemble at "now"
    const wsNow = WeatherEnsembleWorker.weightedValueAt(windSpdModels, nowIndex);
    const wdNow = WeatherEnsembleWorker.weightedCircularMeanAt(windDirModels, nowIndex);
    const wgNow = WeatherEnsembleWorker.weightedValueAt(windGustModels, nowIndex);
    const windEnsemble = (wsNow.value !== null || wdNow !== null || wgNow.value !== null)
        ? { speed: wsNow.value, dir: wdNow, gust: wgNow.value, modelsReporting: wsNow.modelsReporting }
        : null;

    const currentAgreement = hourlyAgreement[0] || 0;
    const currentStatus    = WeatherEnsembleWorker.classifyWetness(currentAgreement);
    let incomingRain = false;
    for (let i = 1; i <= 3 && i < hourlyAgreement.length; i++) {
        if (WeatherEnsembleWorker.classifyWetness(hourlyAgreement[i]) === 'RAIN_LIKELY') { incomingRain = true; break; }
    }

    return { curr, rEU, rUS, rDE, rJP, rainData, uvData, solarData, times, hourlyAgreement,
             tempBand, currentAgreement, currentStatus, incomingRain,
             nodeHealth, codeAgreement, windEnsemble };
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
            case 'NORMALIZE_TELEMETRY':
                result = normalizeTelemetryDataWorker(payload.dCurr, payload.dFore, payload.dSolar, payload.isOffline);
                break;
            default:
                throw new Error("Unknown worker task vector: " + type);
        }
        self.postMessage({ messageId, result });
    } catch (error) {
        self.postMessage({ messageId, error: error.message, stack: error.stack });
    }
};