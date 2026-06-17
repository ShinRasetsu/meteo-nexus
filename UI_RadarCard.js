/**
 * UI_RadarCard.js
 * Active Aero Telemetry Vector HUD with Delta-Time Normalized Physics
 */
export class RadarCard {
    constructor(containerId) {
        this.containerId = containerId;
        this.cardElement = null;
        this.renderFrameId = null;
        this.lastHistoryTime = 0;
        this.historyIdx = 0;
        this.windHistory = new Float32Array([-1, -1, -1]);
        
        // Internal state dampeners
        this.smoothedPitch = 0;
        this.smoothedRoll = 0;
        this.lastRenderTime = null;
        
        // DOM Element Cache
        this.DOM = {};
        
        // UI String Cache (Prevents layout thrashing)
        this._uiCache = { alt: '', windSpeed: '', gust: '', ringTrans: '', horizonTrans: '', relAngle: '', windTrans: '', head: '', cross: '' };
        
        // Bind context
        this.renderLoop = this.renderLoop.bind(this);
        this.handleDeviceOrientation = this.handleDeviceOrientation.bind(this);
    }

    computeRobustHeading(alpha, beta, gamma) {
        const rad = Math.PI / 180;
        const a = alpha * rad, b = beta * rad, g = gamma * rad;
        const cA = Math.cos(a), sA = Math.sin(a);
        const cB = Math.cos(b), sB = Math.sin(b);
        const cG = Math.cos(g), sG = Math.sin(g);

        const yX = -sA * cB;
        const yY = cA * cB;
        const zX = -cA * sG - sA * sB * cG;
        const zY = -sA * sG + cA * sB * cG;

        const weightY = Math.cos(b);
        const weightZ = Math.sin(b); 
        
        const dirX = yX * Math.abs(weightY) + zX * Math.abs(weightZ);
        const dirY = yY * Math.abs(weightY) + zY * Math.abs(weightZ);

        let heading = Math.atan2(dirX, dirY) * (180 / Math.PI);
        if (heading < 0) heading += 360;
        return heading;
    }

    getCardinalStr(deg) {
        const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        return arr[Math.floor((deg / 22.5) + 0.5) % 16];
    }

    initSensors() {
        const st = window.__METEO_CORE_STATE;
        
        if ('AbsoluteOrientationSensor' in window) {
            try {
                const sensor = new AbsoluteOrientationSensor({ frequency: 60 });
                sensor.addEventListener('reading', () => {
                    st.quaternionActive = true;
                    const q = sensor.quaternion;
                    const vx = 2 * (q[0]*q[2] - q[3]*q[1]);
                    const vy = 2 * (q[1]*q[2] + q[3]*q[0]);
                    let heading = Math.atan2(vx, vy) * (180 / Math.PI);
                    st.deviceHeading = (heading + 360) % 360;
                });
                sensor.start();
                this.aosSensor = sensor;
            } catch(e) {} 
        }

        window.addEventListener('deviceorientation', this.handleDeviceOrientation);
    }

    handleDeviceOrientation(e) {
        const st = window.__METEO_CORE_STATE;
        
        if (e.webkitCompassHeading !== undefined) {
            st.deviceHeading = e.webkitCompassHeading;
        } else if (e.alpha !== null && e.beta !== null && e.gamma !== null && !st.quaternionActive) {
            st.deviceHeading = this.computeRobustHeading(e.alpha, e.beta, e.gamma);
        }

        if (e.beta !== null && e.gamma !== null) {
            const rad = Math.PI / 180;
            const b = e.beta * rad;
            const g = e.gamma * rad;

            const gx = Math.cos(b) * Math.sin(g);
            const gy = Math.sin(b);
            const gz = Math.cos(b) * Math.cos(g);

            st.roll = Math.atan2(gx, gy) * (180 / Math.PI);
            st.pitch = Math.asin(gz) * (180 / Math.PI); 
        }
    }

    renderLoop(timestamp) {
        this.renderFrameId = requestAnimationFrame(this.renderLoop);
        
        // Delta-Time (dt) calculation for frame-rate independence
        if (!this.lastRenderTime) this.lastRenderTime = timestamp;
        const dt = (timestamp - this.lastRenderTime) / 1000.0;
        this.lastRenderTime = timestamp;

        const st = window.__METEO_CORE_STATE;
        const now = Date.now();
        let activeHeading = 0;
        let headingValid = false;

        if (this.DOM.altContainer) {
            let altStr = `<span class="bg-surface-700 text-brand-orange text-[9px] px-1.5 py-0.5 rounded uppercase tracking-widest border border-surface-600">2D FIX</span>`;
            if (st.altitude !== null && st.altitude !== undefined) {
                altStr = `<span id="ui-radar-alt" class="font-mono text-lg font-black text-brand-orange drop-shadow-md">${Math.round(st.altitude)}</span><span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest ml-1">m</span>`;
            } else if (st.topoAltitude !== null && st.topoAltitude !== undefined) {
                altStr = `<span id="ui-radar-alt" class="font-mono text-lg font-black text-brand-orange drop-shadow-md">${Math.round(st.topoAltitude)}</span><span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest ml-1">m (TOPO)</span>`;
            }
            if (this._uiCache.alt !== altStr) { this.DOM.altContainer.innerHTML = altStr; this._uiCache.alt = altStr; }
        }

        if (this.DOM.windSpeed) {
            const wsStr = st.windSpeed !== null && st.windSpeed !== undefined ? Math.round(st.windSpeed).toString() : '--';
            if (this._uiCache.windSpeed !== wsStr) { this.DOM.windSpeed.textContent = wsStr; this._uiCache.windSpeed = wsStr; }
        }
        
        if (this.DOM.gust && st.windGust > 0) {
            const gustDiff = st.windGust - st.windSpeed;
            if (gustDiff >= 5) {
                const gStr = `GUST +${Math.round(gustDiff)}`;
                if (this._uiCache.gust !== gStr) {
                    this.DOM.gust.classList.remove('opacity-0');
                    this.DOM.gust.textContent = gStr;
                    this._uiCache.gust = gStr;
                }
            } else if (this._uiCache.gust !== 'hidden') {
                this.DOM.gust.classList.add('opacity-0');
                this._uiCache.gust = 'hidden';
            }
        }
        
        // Physics Normalization: Time Constant (0.1s response time) mapped against Delta-Time
        if (this.DOM.horizon) {
            const timeConstant = 0.1; 
            const alpha = dt / (timeConstant + dt);
            
            this.smoothedPitch = (alpha * st.pitch) + ((1 - alpha) * this.smoothedPitch);
            this.smoothedRoll = (alpha * st.roll) + ((1 - alpha) * this.smoothedRoll);
            
            let pY = (this.smoothedPitch - 30) * 1.5; 
            pY = Math.max(-60, Math.min(60, pY)); 
            
            const hTrans = `translateY(${pY.toFixed(1)}px) rotate(${-this.smoothedRoll.toFixed(1)}deg)`;
            if (this._uiCache.horizonTrans !== hTrans) { this.DOM.horizon.style.transform = hTrans; this._uiCache.horizonTrans = hTrans; }
        }
        
        // TTL Hardware Enforcement
        if (st.speed > 1.5 && st.gnssHeading !== null && st.gnssHeading !== undefined && (now - st.lastGnssUpdate < 3000)) {
            activeHeading = st.gnssHeading;
            headingValid = true;
        } else if (st.deviceHeading !== null && st.deviceHeading !== undefined) {
            activeHeading = st.deviceHeading;
            headingValid = true;
        }

        if (headingValid && this.DOM.ring) {
            const ringT = `rotate(${-activeHeading.toFixed(1)}deg)`;
            if (this._uiCache.ringTrans !== ringT) { this.DOM.ring.style.transform = ringT; this._uiCache.ringTrans = ringT; }
        }

        const wDir = st.windDir; 
        if (headingValid && wDir !== null && wDir !== undefined) {
            const relAngle = (wDir - activeHeading + 360) % 360;
            
            if (this.DOM.relAngle) {
                const relStr = `${relAngle.toFixed(0)}<span class="text-[12px] font-bold text-gray-500 ml-1.5 tracking-widest leading-none">° ${this.getCardinalStr(wDir)}</span>`;
                if (this._uiCache.relAngle !== relStr) { this.DOM.relAngle.innerHTML = relStr; this._uiCache.relAngle = relStr; }
            }

            if (this.DOM.windLayer) {
                const wT = `rotate(${relAngle.toFixed(1)}deg)`;
                if (this._uiCache.windTrans !== wT) { this.DOM.windLayer.style.transform = wT; this._uiCache.windTrans = wT; }
            }

            const rad = relAngle * (Math.PI / 180);
            const headForce = Math.cos(rad) * st.windSpeed;
            const crossForce = Math.sin(rad) * st.windSpeed;
            
            if (this.DOM.head) {
                const hStr = `<span class="${headForce > 0 ? 'text-brand-orange' : 'text-brand-success'}">${headForce > 0 ? 'HWD' : 'TAL'}: ${Math.abs(headForce).toFixed(0)}</span>`;
                if (this._uiCache.head !== hStr) { this.DOM.head.innerHTML = hStr; this._uiCache.head = hStr; }
            }
            
            if (this.DOM.cross) {
                const cStr = `CRS: ${Math.abs(crossForce).toFixed(0)} <i class="fa-solid fa-arrow-${crossForce > 0 ? 'left' : 'right'}"></i>`;
                if (this._uiCache.cross !== cStr) { this.DOM.cross.innerHTML = cStr; this._uiCache.cross = cStr; }
            }

            if (now - this.lastHistoryTime > 10000) {
                if (!isNaN(relAngle)) {
                    this.windHistory[this.historyIdx] = relAngle;
                }
                this.historyIdx = (this.historyIdx + 1) % 3;
                this.lastHistoryTime = this.lastHistoryTime === 0 ? now : this.lastHistoryTime + 10000;
            }
            
            for (let i = 0; i < 3; i++) {
                const age = (this.historyIdx - 1 - i + 3) % 3; 
                const histAngle = this.windHistory[age];
                
                if (histAngle !== -1 && !isNaN(histAngle)) {
                    const ghostEl = this.DOM[`ghost${i+1}`];
                    if (ghostEl) ghostEl.style.transform = `rotate(${histAngle.toFixed(1)}deg)`;
                }
            }
        }
    }

    mount() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        this.cardElement = document.createElement('div');
        this.cardElement.className = "lg:col-span-12 w-full mt-2";
        
        this.cardElement.innerHTML = `
            <div id="radar-main-card" class="bg-surface-900 border-4 border-surface-800 rounded-2xl p-4 flex flex-col justify-center items-center relative overflow-hidden min-h-[220px] transition-all duration-300">
                <div class="absolute top-3 left-4 flex justify-between items-start w-[calc(100%-2rem)] z-30 pointer-events-none">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold tracking-widest uppercase text-brand-teal"><i class="fa-solid fa-jet-fighter mr-2"></i> Aero-Vector HUD</span>
                        <span id="ui-radar-gust" class="text-[10px] font-black text-brand-red uppercase tracking-widest mt-1 opacity-0 transition-opacity drop-shadow-md">GUST WARNING</span>
                    </div>
                    <div class="flex items-start gap-4">
                        <div class="text-right pointer-events-none">
                            <span class="text-[10px] font-bold text-brand-orange uppercase tracking-widest block mb-0.5">ALTIMETER</span>
                            <div class="flex items-baseline gap-1 justify-end" id="ui-radar-alt-container">
                                <span id="ui-radar-alt" class="font-mono text-lg font-black text-brand-orange drop-shadow-md">--</span>
                                <span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest">m</span>
                            </div>
                        </div>
                        <button id="radar-expand-btn" class="text-brand-teal hover:text-white transition-colors p-2 bg-surface-800 border-2 border-surface-700 rounded-lg flex items-center justify-center pointer-events-auto shadow-sm"><i class="fa-solid fa-expand text-base"></i></button>
                    </div>
                </div>
                
                <div id="radar-dial-scaler" class="relative w-44 h-44 mt-6 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-center">
                    <div id="ui-radar-horizon-layer" class="absolute inset-0 transition-transform duration-75 flex items-center justify-center z-0 pointer-events-none opacity-60">
                        <div class="w-full h-[2px] bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,1)] relative flex justify-between px-2">
                            <div class="w-4 h-[2px] bg-yellow-500 absolute left-2 -top-4"></div>
                            <div class="w-4 h-[2px] bg-yellow-500 absolute left-2 top-4"></div>
                            <div class="w-4 h-[2px] bg-yellow-500 absolute right-2 -top-4"></div>
                            <div class="w-4 h-[2px] bg-yellow-500 absolute right-2 top-4"></div>
                        </div>
                    </div>
                    <div id="ui-radar-ring" class="absolute inset-0 rounded-full border-[3px] border-surface-700/80 transition-transform duration-300 pointer-events-none shadow-[inset_0_0_15px_rgba(0,0,0,0.4)] z-10">
                        <div class="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] text-gray-400 font-black bg-surface-900 px-1 rounded border border-surface-700">N</div>
                        <div class="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[10px] text-gray-600 font-black bg-surface-900 px-1 rounded border border-surface-700">S</div>
                        <div class="absolute top-1/2 -left-3 -translate-y-1/2 text-[10px] text-gray-600 font-black bg-surface-900 py-0.5 rounded border border-surface-700">W</div>
                        <div class="absolute top-1/2 -right-3 -translate-y-1/2 text-[10px] text-gray-600 font-black bg-surface-900 py-0.5 rounded border border-surface-700">E</div>
                    </div>
                    <div class="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none">
                        <div class="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-transparent border-b-cyan-500 mb-1 drop-shadow-[0_0_10px_rgba(6,182,212,1)]"></div>
                        <div class="w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,1)] border-2 border-surface-900"></div>
                    </div>
                    <div id="ui-radar-wind-ghost-3" class="absolute inset-0 transition-transform duration-1000 flex items-start justify-center z-10 pointer-events-none opacity-10">
                        <div class="flex flex-col items-center"><div class="w-[2px] h-6 bg-brand-blue -mt-[18px]"></div><div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-[5px] border-transparent border-t-brand-blue"></div></div>
                    </div>
                    <div id="ui-radar-wind-ghost-2" class="absolute inset-0 transition-transform duration-1000 flex items-start justify-center z-10 pointer-events-none opacity-20">
                        <div class="flex flex-col items-center"><div class="w-[2px] h-6 bg-brand-blue -mt-[18px]"></div><div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-[5px] border-transparent border-t-brand-blue"></div></div>
                    </div>
                    <div id="ui-radar-wind-ghost-1" class="absolute inset-0 transition-transform duration-1000 flex items-start justify-center z-10 pointer-events-none opacity-40">
                        <div class="flex flex-col items-center"><div class="w-[2px] h-6 bg-brand-blue -mt-[18px]"></div><div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-[5px] border-transparent border-t-brand-blue"></div></div>
                    </div>
                    <div id="ui-radar-wind-layer" class="absolute inset-0 transition-transform duration-300 flex items-start justify-center z-30 pointer-events-none">
                        <div class="flex flex-col items-center">
                            <i class="fa-solid fa-wind text-brand-blue text-sm -mt-6 mb-0.5 drop-shadow-[0_0_5px_rgba(59,130,246,0.8)]"></i>
                            <div class="w-[2px] h-6 bg-brand-blue shadow-[0_0_8px_rgba(59,130,246,1)]"></div>
                            <div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-[5px] border-transparent border-t-brand-blue"></div>
                        </div>
                    </div>
                </div>

                <div class="absolute bottom-4 left-4 right-4 flex justify-between items-end z-30 pointer-events-none">
                    <div>
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-0.5">Rel. Angle</span>
                        <div class="flex items-baseline gap-1">
                            <span id="ui-radar-rel-angle" class="font-mono text-xl md:text-2xl font-black text-gray-300 drop-shadow-md">--</span>
                        </div>
                    </div>
                    <div class="text-right flex flex-col items-end">
                        <span class="text-[10px] font-bold text-brand-blue uppercase tracking-widest block mb-0.5">Wind Base</span>
                        <div class="flex items-baseline gap-1 justify-end mb-1">
                            <span id="ui-radar-wind-speed" class="font-mono text-2xl md:text-3xl font-black text-brand-blue drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">--</span>
                            <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">km/h</span>
                        </div>
                        <div class="flex gap-2 text-[9px] font-mono font-bold text-gray-400 uppercase tracking-widest bg-surface-800/80 px-2 py-0.5 rounded border border-surface-700">
                            <span id="ui-radar-crosswind">CRS: 0</span> <span class="text-surface-600">|</span> <span id="ui-radar-headwind">HWD: 0</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(this.cardElement);
        this.cacheDOM();
        this.setupInteractions();
        this.initSensors();
        this.renderFrameId = requestAnimationFrame(this.renderLoop);
    }

    cacheDOM() {
        const q = (sel) => this.cardElement.querySelector(sel);
        this.DOM = {
            mainCard: q('#radar-main-card'),
            ring: q('#ui-radar-ring'),
            windLayer: q('#ui-radar-wind-layer'),
            relAngle: q('#ui-radar-rel-angle'),
            windSpeed: q('#ui-radar-wind-speed'),
            altContainer: q('#ui-radar-alt-container'),
            gust: q('#ui-radar-gust'),
            cross: q('#ui-radar-crosswind'),
            head: q('#ui-radar-headwind'),
            horizon: q('#ui-radar-horizon-layer'),
            ghost1: q('#ui-radar-wind-ghost-1'),
            ghost2: q('#ui-radar-wind-ghost-2'),
            ghost3: q('#ui-radar-wind-ghost-3'),
            scaler: q('#radar-dial-scaler'),
            expandBtn: q('#radar-expand-btn')
        };
    }

    setupInteractions() {
        let isRadarFullscreen = false;
        this.DOM.expandBtn.addEventListener('click', () => {
            isRadarFullscreen = !isRadarFullscreen;
            if (isRadarFullscreen) {
                this.DOM.mainCard.classList.add('fixed', 'inset-0', 'z-[9999]', 'h-[100dvh]', 'rounded-none', 'bg-surface-900/95', 'backdrop-blur-md');
                this.DOM.mainCard.classList.remove('relative', 'rounded-2xl', 'min-h-[220px]', 'bg-surface-900', 'border-4');
                
                const minDimension = Math.min(window.innerWidth, window.innerHeight);
                const scaleFactor = (minDimension * 0.6) / 160; 
                this.DOM.scaler.style.transform = `scale(${scaleFactor})`;
                
                this.DOM.expandBtn.innerHTML = '<i class="fa-solid fa-compress text-base"></i>';
                document.body.classList.add('overflow-hidden');
            } else {
                this.DOM.mainCard.classList.remove('fixed', 'inset-0', 'z-[9999]', 'h-[100dvh]', 'rounded-none', 'bg-surface-900/95', 'backdrop-blur-md');
                this.DOM.mainCard.classList.add('relative', 'rounded-2xl', 'min-h-[220px]', 'bg-surface-900', 'border-4');
                
                this.DOM.scaler.style.transform = 'scale(1)';
                
                this.DOM.expandBtn.innerHTML = '<i class="fa-solid fa-expand text-base"></i>';
                document.body.classList.remove('overflow-hidden');
            }
        });
    }

    destroy() {
        if (this.renderFrameId) cancelAnimationFrame(this.renderFrameId);
        window.removeEventListener('deviceorientation', this.handleDeviceOrientation);
        if (this.aosSensor) this.aosSensor.stop();
        if (this.cardElement) this.cardElement.remove();
    }
}