/**
 * UI_FuelModal.js
 * Encapsulates the Fuel Preferences Modal, Overpass API Node Extraction,
 * Pitstop Routing logic, and Protected IndexedDB I/O boundaries.
 */
export class FuelModal {
    constructor() {
        this.storageKey = 'meteo_fuel_prefs';
        this.memoryConfig = { brand: 'Shell', variant: 'V-Power Racing', avoidTolls: false, avoidHighways: false, avoidFerries: false };
        this._isInitialized = false;
        
        // Cache DOM elements specific to this module
        this.DOM = {};
    }

    getConfig() {
        return this.memoryConfig;
    }

    /**
     * Wrap IndexedDB read in a Promise.race to prevent Safari/WebKit Infinite Hanging bug
     */
    async _safeStorageGet(key, timeoutMs = 2000) {
        if (!window.localforage) return null;
        return Promise.race([
            window.localforage.getItem(key),
            new Promise((_, reject) => setTimeout(() => reject(new Error('IndexedDB Read Timeout')), timeoutMs))
        ]).catch(e => {
            console.warn("Storage warning: ", e);
            return null;
        });
    }

    async loadConfig() {
        try {
            // Priority 1: Cloud Firestore Sync (Assumes Firebase globals are available during transition)
            if (window.isCloudActive && window.state && window.state.userAuth && window.firestoreOps) {
                const docRef = window.firestoreOps.doc(window.db, 'artifacts', window.appId, 'users', window.state.userAuth.uid, 'settings', 'fuel_prefs');
                const docSnap = await window.firestoreOps.getDoc(docRef);
                if (docSnap.exists()) {
                    this.memoryConfig = { ...this.memoryConfig, ...docSnap.data() };
                    return; 
                }
            }
            // Priority 2: Offline IndexedDB Backup (Timeout Protected)
            const stored = await this._safeStorageGet(this.storageKey);
            if (stored) {
                this.memoryConfig = { ...this.memoryConfig, ...stored };
            }
        } catch (e) {
            console.warn("FuelModal: Storage fetch failed. Using hard defaults.", e);
        }
    }

    async saveConfig(conf) {
        this.memoryConfig = conf;
        try {
            // Sync up to Cloud if active
            if (window.isCloudActive && window.state && window.state.userAuth && window.firestoreOps) {
                const docRef = window.firestoreOps.doc(window.db, 'artifacts', window.appId, 'users', window.state.userAuth.uid, 'settings', 'fuel_prefs');
                await window.firestoreOps.setDoc(docRef, conf, { merge: true });
            }
            // Persist locally for offline operation
            if (window.localforage) {
                await window.localforage.setItem(this.storageKey, conf);
            }
            
            if (window.updateText && window.DOM && window.DOM.statusEl) {
                window.updateText(window.DOM.statusEl, "FUEL CONFIG SAVED");
                window.updateClass(window.DOM.statusEl, "text-xs md:text-sm font-bold text-brand-orange uppercase tracking-widest bg-brand-orange/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-orange/50 whitespace-nowrap");
            }
        } catch(e) {
            console.error("FuelModal: Config save failed", e);
        }
    }

    _processOverpassPayload(data, lat, lon, targetBrand, targetVariant) {
        if (!data.elements || data.elements.length === 0) return { stations: [], isStrict: false };
        
        let results = new Map();
        let exactMatchesCount = 0;
        const reqOsmTag = window.VARIANT_OSM_MAP ? window.VARIANT_OSM_MAP[targetVariant] : null;

        data.elements.forEach(el => {
            const tLat = el.lat || el.center.lat; 
            const tLon = el.lon || el.center.lon;
            const id = `${tLat.toFixed(4)},${tLon.toFixed(4)}`;
            
            if (!results.has(id)) {
                const d = window.fastDistance(lat, lon, tLat, tLon);
                let isExact = false;
                
                if (reqOsmTag && el.tags && el.tags[reqOsmTag] === 'yes') {
                    isExact = true;
                    exactMatchesCount++;
                }
                
                results.set(id, { 
                    lat: tLat, lon: tLon, 
                    name: el.tags.name || targetBrand, 
                    dist: (d/1000).toFixed(1),
                    isExact: isExact
                });
            }
        });
        
        let finalArray = Array.from(results.values());
        let isStrictFiltered = false;
        
        if (exactMatchesCount > 0 && reqOsmTag) {
            finalArray = finalArray.filter(s => s.isExact);
            isStrictFiltered = true;
        }
        
        finalArray.sort((a,b) => parseFloat(a.dist) - parseFloat(b.dist));
        finalArray.forEach(s => { s.strictFilterActive = isStrictFiltered; });
        
        return { stations: finalArray, isStrict: isStrictFiltered };
    }

    async findAllAlongRoute(lat, lon, routeNodes) {
        const conf = this.getConfig();
        let upcoming = [];
        for (let i = 0; i < routeNodes.length; i++) {
            if (!routeNodes[i].passed) upcoming.push(routeNodes[i]);
        }
        
        if (upcoming.length === 0) return await this.findAllNearest(lat, lon);

        let sampled = [];
        let step = Math.max(1, Math.floor(upcoming.length / 15));
        for(let i=0; i<upcoming.length; i+=step) sampled.push(upcoming[i]);
        if(sampled[sampled.length-1] !== upcoming[upcoming.length-1]) sampled.push(upcoming[upcoming.length-1]);

        const cacheKey = `fuel_route_all_${conf.brand}_${sampled[0].lat.toFixed(2)}_${sampled[0].lon.toFixed(2)}`;
        
        const cached = await this._safeStorageGet(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 3600000)) return cached.data;

        let queryParts = [];
        sampled.forEach(node => {
            queryParts.push(`node["amenity"="fuel"]["brand"~"${conf.brand}",i](around:3500,${node.lat},${node.lon});`);
            queryParts.push(`way["amenity"="fuel"]["brand"~"${conf.brand}",i](around:3500,${node.lat},${node.lon});`);
        });

        const query = `[out:json][timeout:25];(${queryParts.join('')});out center;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        
        try {
            const res = await window.fetchWithRetry(url, { timeout: 25000 }, 2, 500);
            const data = await res.json();
            
            const processedData = this._processOverpassPayload(data, lat, lon, conf.brand, conf.variant);
            if (window.localforage) {
                await window.localforage.setItem(cacheKey, { data: processedData, timestamp: Date.now() });
            }
            return processedData;
        } catch(e) { return { stations: [], isStrict: false }; }
    }

    async findAllNearest(lat, lon) {
        const conf = this.getConfig();
        const cacheKey = `fuel_nearest_all_${conf.brand}_${lat.toFixed(2)}_${lon.toFixed(2)}`;
        
        const cached = await this._safeStorageGet(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 86400000)) return cached.data;

        const query = `[out:json][timeout:15];(node["amenity"="fuel"]["brand"~"${conf.brand}",i](around:20000,${lat},${lon});way["amenity"="fuel"]["brand"~"${conf.brand}",i](around:20000,${lat},${lon}););out center;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        
        try {
            const res = await window.fetchWithRetry(url, { timeout: 15000 }, 2, 500);
            const data = await res.json();
            
            const processedData = this._processOverpassPayload(data, lat, lon, conf.brand, conf.variant);
            if (window.localforage) {
                await window.localforage.setItem(cacheKey, { data: processedData, timestamp: Date.now() });
            }
            return processedData;
        } catch(e) { return { stations: [], isStrict: false }; }
    }

    async triggerIntercept() {
        const state = window.state;
        const DOM = window.DOM;

        if (!state.autoCoords) {
            window.updateText(DOM.statusEl, "NO GPS LOCK FOR FUEL");
            window.updateClass(DOM.statusEl, "text-xs md:text-sm font-bold text-brand-red uppercase tracking-widest bg-brand-red/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-red/50 whitespace-nowrap");
            return;
        }
        
        if (state.fuelMarkers && state.fuelMarkers.length > 0) {
            state.fuelMarkers.forEach(m => state.mapObj.removeLayer(m));
        }
        state.fuelMarkers = [];

        window.updateHTML(DOM.statusEl, `<i class="fa-solid fa-satellite-dish fa-fade mr-2"></i> SCANNING FOR ${this.getConfig().brand}...`);
        window.updateClass(DOM.statusEl, "text-xs md:text-sm font-bold text-brand-orange uppercase tracking-widest bg-brand-orange/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-orange/50 animate-pulse whitespace-nowrap");
        
        let searchNodes = state.originalRouteNodes || state.routeNodes;
        let payload = { stations: [], isStrict: false };

        if (searchNodes && searchNodes.some(n => !n.passed)) {
            payload = await this.findAllAlongRoute(state.autoCoords.lat, state.autoCoords.lon, searchNodes);
            if (!payload.stations || payload.stations.length === 0) {
                payload = await this.findAllNearest(state.autoCoords.lat, state.autoCoords.lon);
            }
        } else {
            payload = await this.findAllNearest(state.autoCoords.lat, state.autoCoords.lon);
        }
        
        if (payload.stations && payload.stations.length > 0) {
            const strictBadgeTxt = payload.isStrict ? `<span class="text-brand-success uppercase"><i class="fa-solid fa-check"></i> EXACT FUEL</span>` : `<span class="text-brand-warning uppercase">BRAND MATCH</span>`;
            
            window.updateHTML(DOM.statusEl, `<i class="fa-solid fa-gas-pump mr-2"></i> FOUND ${payload.stations.length} ${window.sanitizeHTML(this.getConfig().brand).toUpperCase()} <span class="hidden md:inline">|</span> <span class="text-[10px] bg-black/40 px-2 py-1 rounded ml-1 tracking-widest">${strictBadgeTxt}</span>`);
            window.updateClass(DOM.statusEl, "text-xs md:text-sm font-bold text-brand-orange uppercase tracking-widest bg-brand-orange/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-orange/50 whitespace-nowrap flex items-center");

            payload.stations.forEach((station) => {
                const marker = L.marker([station.lat, station.lon], {
                    icon: L.divIcon({
                        className: 'custom-fuel-icon',
                        html: `<div class="bg-brand-orange text-black border-2 border-black rounded-full w-8 h-8 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.8)] cursor-pointer hover:scale-110 transition-transform"><i class="fa-solid fa-gas-pump"></i></div>`,
                        iconSize: [32, 32], iconAnchor: [16, 16]
                    }),
                    zIndexOffset: 2000
                }).addTo(state.mapObj);

                const popupContent = document.createElement('div');
                popupContent.className = "p-1";
                
                const matchBadgeUI = station.strictFilterActive || station.isExact
                    ? `<span class="text-[9px] bg-brand-success text-black px-2 py-1 rounded font-black uppercase tracking-widest shadow-[0_0_10px_rgba(34,197,94,0.4)]"><i class="fa-solid fa-check-double mr-1"></i> Exact Match</span>`
                    : `<span class="text-[9px] bg-surface-700 text-gray-400 px-2 py-1 rounded font-bold uppercase tracking-widest" title="Specific fuel variant not tagged in OSM database. Showing Brand matches."><i class="fa-solid fa-circle-info mr-1"></i> Brand Match Only</span>`;

                popupContent.innerHTML = `
                    <div class="text-center font-sans w-44">
                        <b class="text-brand-orange text-xs uppercase tracking-widest block mb-1 truncate" title="${window.sanitizeHTML(station.name)}">${window.sanitizeHTML(station.name)}</b>
                        <div class="text-[10px] text-gray-400 font-mono mb-2">${window.sanitizeHTML(this.getConfig().variant)} • ${window.sanitizeHTML(station.dist)}km</div>
                        <div class="mb-2">${matchBadgeUI}</div>
                        <div class="flex gap-1.5 mb-2 w-full">
                            <button aria-label="Official Source Verification" class="verify-official-btn bg-surface-700 text-gray-300 font-bold text-[9px] py-1.5 rounded uppercase tracking-widest flex-1 hover:bg-surface-600 transition-colors border border-surface-600" title="Check Official Availability"><i class="fa-solid fa-globe text-brand-orange mb-0.5 block text-xs"></i>Official</button>
                            <button aria-label="Google Maps Verification" class="verify-gmaps-btn bg-surface-700 text-gray-300 font-bold text-[9px] py-1.5 rounded uppercase tracking-widest flex-1 hover:bg-surface-600 transition-colors border border-surface-600" title="Check 24/7 Hours & Reviews"><i class="fa-solid fa-map-location-dot text-brand-blue mb-0.5 block text-xs"></i>GMaps</button>
                        </div>
                        <button aria-label="Route to Pit Stop" class="set-pitstop-btn bg-brand-orange text-black font-black text-[10px] px-3 py-2 rounded-md uppercase tracking-widest shadow-[0_0_10px_rgba(245,158,11,0.4)] w-full hover:bg-orange-400 transition-colors"><i class="fa-solid fa-route mr-1"></i> Route Here</button>
                    </div>
                `;

                marker.bindPopup(popupContent, { className: 'custom-popup-dark', offset: [0, -10] });

                marker.on('popupopen', () => {
                    const btn = popupContent.querySelector('.set-pitstop-btn');
                    if (btn) {
                        btn.onclick = () => {
                            marker.closePopup();
                            this.setPitstopRoute(station);
                        };
                    }
                    
                    const offBtn = popupContent.querySelector('.verify-official-btn');
                    if (offBtn) {
                        offBtn.onclick = () => {
                            const url = window.BRAND_LINKS[this.getConfig().brand] || "https://www.google.com/search?q=" + encodeURIComponent(this.getConfig().brand + " gas station locator");
                            window.open(url, '_blank');
                        };
                    }

                    const gmapsBtn = popupContent.querySelector('.verify-gmaps-btn');
                    if (gmapsBtn) {
                        gmapsBtn.onclick = () => {
                            const url = `https://www.google.com/maps/search/$${encodeURIComponent(station.name)}+Gas+Station/@${station.lat},${station.lon},17z`;
                            window.open(url, '_blank');
                        };
                    }
                });

                state.fuelMarkers.push(marker);
            });

            let boundsCoords = payload.stations.map(s => L.latLng(s.lat, s.lon));
            boundsCoords.push(L.latLng(state.autoCoords.lat, state.autoCoords.lon));
            state.mapObj.fitBounds(L.latLngBounds(boundsCoords), { padding: [50, 50], maxZoom: 14, animate: true });

        } else {
            window.updateHTML(DOM.statusEl, `<i class="fa-solid fa-triangle-exclamation mr-2"></i> NO ${window.sanitizeHTML(this.getConfig().brand).toUpperCase()} DETECTED`);
            window.updateClass(DOM.statusEl, "text-xs md:text-sm font-bold text-brand-red uppercase tracking-widest bg-brand-red/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-red/50 whitespace-nowrap");
        }
    }

    setPitstopRoute(station) {
        const state = window.state;
        const DOM = window.DOM;

        window.updateHTML(DOM.statusEl, `<i class="fa-solid fa-route fa-fade mr-2"></i> ROUTING TO PITSTOP...`);
        window.updateClass(DOM.statusEl, "text-xs md:text-sm font-bold text-brand-blue uppercase tracking-widest bg-brand-blue/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-blue/50 animate-pulse whitespace-nowrap");

        if (state.routeCtrl) {
            if (state.isFuelOnlyRoute) {
                window.activateLiveNavigation(station.lat, station.lon, true);
            } else {
                let wps = state.routeCtrl.getWaypoints();
                const origin = wps[0].latLng || L.latLng(state.autoCoords.lat, state.autoCoords.lon);
                const dest = wps[wps.length - 1].latLng;
                
                state.routeNodes = null;
                state.lastIntelFetch = 0;
                if (state.intelFetchAbortController) state.intelFetchAbortController.abort();
                
                state.routeCtrl.setWaypoints([origin, L.latLng(station.lat, station.lon), dest]);
            }
        } else {
            window.activateLiveNavigation(station.lat, station.lon, true);
        }
    }

    async init() {
        if (this._isInitialized) return;
        this._isInitialized = true;
        
        await this.loadConfig();
        const conf = this.getConfig();
        const DOM = window.DOM; 
        
        DOM.fuel.brand.innerHTML = '';
        if (window.FUEL_CATALOG) {
            Object.keys(window.FUEL_CATALOG).forEach(brand => {
                const opt = document.createElement('option');
                opt.value = brand;
                opt.textContent = brand;
                DOM.fuel.brand.appendChild(opt);
            });
        }

        const updateVariants = (selectedBrand) => {
            DOM.fuel.variant.innerHTML = '';
            const variants = (window.FUEL_CATALOG && window.FUEL_CATALOG[selectedBrand]) ? window.FUEL_CATALOG[selectedBrand] : ["Any"];
            variants.forEach(variant => {
                const opt = document.createElement('option');
                opt.value = variant;
                opt.textContent = variant;
                DOM.fuel.variant.appendChild(opt);
            });
        };

        DOM.fuel.brand.addEventListener('change', (e) => {
            updateVariants(e.target.value);
        });

        DOM.fuel.brand.value = (window.FUEL_CATALOG && window.FUEL_CATALOG[conf.brand]) ? conf.brand : 'Shell';
        updateVariants(DOM.fuel.brand.value);
        
        if (Array.from(DOM.fuel.variant.options).some(opt => opt.value === conf.variant)) {
            DOM.fuel.variant.value = conf.variant;
        }

        const officialBtn = document.getElementById('btn-official-locator');
        if (officialBtn) {
            officialBtn.addEventListener('click', () => {
                const currentBrand = DOM.fuel.brand.value;
                const url = (window.BRAND_LINKS && window.BRAND_LINKS[currentBrand]) ? window.BRAND_LINKS[currentBrand] : "https://www.google.com/search?q=" + encodeURIComponent(currentBrand + " gas station locator Philippines");
                window.open(url, '_blank');
            });
        }

        DOM.fuel.toll.checked = conf.avoidTolls;
        DOM.fuel.highway.checked = conf.avoidHighways;
        DOM.fuel.ferry.checked = conf.avoidFerries;
        
        DOM.fuel.save.addEventListener('click', () => {
            this.saveConfig({ 
                brand: DOM.fuel.brand.value, 
                variant: DOM.fuel.variant.value,
                avoidTolls: DOM.fuel.toll.checked,
                avoidHighways: DOM.fuel.highway.checked,
                avoidFerries: DOM.fuel.ferry.checked
            });
            
            window.closeModal('fuel-settings-modal');
            
            const state = window.state;
            if (state.routeCtrl) {
                const wps = state.routeCtrl.getWaypoints();
                state.mapObj.removeControl(state.routeCtrl);
                state.routeCtrl = null;
                window.initRoute(false, wps);
            } else if (state.targetCoords && state.autoCoords) {
                window.activateLiveNavigation(state.targetCoords.lat, state.targetCoords.lon, state.isFuelOnlyRoute);
            }
        });
        
        DOM.fuel.trigger.addEventListener('click', () => this.triggerIntercept());
    }
}