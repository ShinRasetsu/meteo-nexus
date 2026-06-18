/**
 * UI_AeroVectorHUD.js
 * Aero Vector HUD - Physics-based Active Aero Telemetry Extension
 * Renders compass ring, horizon visualization, wind vectors, and altimeter
 */

export class AeroVectorHUD {
    constructor() {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.animationId = null;
        this._uiCache = {};
        this._windHistory = [0, 0, 0];
        this._sensorData = {
            alpha: 0,
            beta: 0,
            gamma: 0,
            heading: 0,
            pitch: 0,
            roll: 0,
            speed: 0,
            altitude: null
        };
        this.isFullScreen = false;
        this.tacticalScale = 1;
        this.lastRenderTime = 0;
        this.renderInterval = 16; // 60fps target
    }

    mount(elementId) {
        this.container = document.getElementById(elementId);
        if (!this.container) {
            console.warn(`[AeroVectorHUD] Container not found: ${elementId}`);
            return;
        }

        // Render the Aero card HTML
        this.container.innerHTML = `
            <div id="sec-aero" class="w-full bg-surface-900 border-4 border-surface-800 rounded-2xl p-4 md:p-6 flex flex-col mt-2 transition-all duration-300">
                <div class="mb-4 flex items-center justify-between">
                    <span class="text-sm font-bold uppercase tracking-widest text-brand-purple">
                        <i class="fa-solid fa-compass mr-2"></i>Active Aero Telemetry
                    </span>
                    <button onclick="window.aeroVectorHUD?.toggleFullScreen()" aria-label="Focus Aero" class="text-brand-teal hover:text-white transition-colors p-2">
                        <i class="fa-solid fa-expand text-lg" id="icon-sec-aero"></i>
                    </button>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div class="lg:col-span-1 flex flex-col gap-4">
                        <div class="bg-surface-800 border-2 border-surface-700 rounded-xl p-4 flex flex-col items-center justify-center min-h-[200px]">
                            <canvas id="compass-ring" width="180" height="180" class="w-full max-w-[180px] h-auto"></canvas>
                        </div>
                        <div class="bg-surface-800 border-2 border-surface-700 rounded-xl p-3 text-center">
                            <div class="text-xs font-bold text-gray-400 uppercase mb-1">Heading</div>
                            <div class="flex items-baseline gap-2 justify-center">
                                <span id="aero-heading-deg" class="font-mono text-2xl font-black text-brand-teal">000°</span>
                                <span id="aero-heading-text" class="text-sm font-bold text-gray-300">N</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="lg:col-span-1 flex flex-col gap-4">
                        <div class="bg-surface-800 border-2 border-surface-700 rounded-xl p-4 flex flex-col items-center justify-center min-h-[200px]">
                            <canvas id="horizon-layer" width="200" height="160" class="w-full max-w-[200px] h-auto"></canvas>
                        </div>
                        <div class="bg-surface-800 border-2 border-surface-700 rounded-xl p-3 text-center">
                            <div class="text-xs font-bold text-gray-400 uppercase mb-1">Pitch / Roll</div>
                            <div class="font-mono text-sm font-black text-brand-blue">
                                <span id="aero-pitch">0°</span> / <span id="aero-roll">0°</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="lg:col-span-1 flex flex-col gap-4">
                        <div class="bg-surface-800 border-2 border-surface-700 rounded-xl p-4 flex flex-col items-center justify-center min-h-[200px]">
                            <canvas id="wind-vector" width="160" height="160" class="w-full max-w-[160px] h-auto"></canvas>
                        </div>
                        <div class="bg-surface-800 border-2 border-surface-700 rounded-xl p-3 text-center text-xs">
                            <div class="font-bold text-gray-400 uppercase mb-1">Wind Decomposition</div>
                            <div class="font-mono space-y-1">
                                <div><span class="text-gray-400">Headwind:</span> <span id="aero-headwind" class="font-black text-brand-orange">0</span> km/h</div>
                                <div><span class="text-gray-400">Crosswind:</span> <span id="aero-crosswind" class="font-black text-brand-purple">0</span> km/h</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div class="bg-surface-800 border border-surface-700 rounded-lg p-2 text-center text-xs">
                        <div class="font-bold text-gray-400">Speed</div>
                        <div class="font-mono font-black text-brand-blue"><span id="aero-speed">0</span> km/h</div>
                    </div>
                    <div class="bg-surface-800 border border-surface-700 rounded-lg p-2 text-center text-xs">
                        <div class="font-bold text-gray-400">Altitude</div>
                        <div class="font-mono font-black text-brand-teal"><span id="aero-altitude">--</span> m</div>
                    </div>
                    <div class="bg-surface-800 border border-surface-700 rounded-lg p-2 text-center text-xs">
                        <div class="font-bold text-gray-400">Wind</div>
                        <div class="font-mono font-black text-brand-warning"><span id="aero-wind">0</span> km/h</div>
                    </div>
                    <div class="bg-surface-800 border border-surface-700 rounded-lg p-2 text-center text-xs">
                        <div class="font-bold text-gray-400">Wind Dir</div>
                        <div class="font-mono font-black text-brand-orange"><span id="aero-winddir">--°</span></div>
                    </div>
                </div>
            </div>
        `;

        // Get canvas contexts
        this.compassCanvas = document.getElementById('compass-ring');
        this.horizonCanvas = document.getElementById('horizon-layer');
        this.windCanvas = document.getElementById('wind-vector');
        
        if (this.compassCanvas) this.compassCtx = this.compassCanvas.getContext('2d');
        if (this.horizonCanvas) this.horizonCtx = this.horizonCanvas.getContext('2d');
        if (this.windCanvas) this.windCtx = this.windCanvas.getContext('2d');

        // Export to window for global access
        window.aeroVectorHUD = this;

        // Start render loop
        this.startRenderLoop();

        // Initialize hardware sensor listeners
        this.initHardwareSensors();
    }

    initHardwareSensors() {
        // Attempt to use AbsoluteOrientationSensor (most accurate)
        if ('AbsoluteOrientationSensor' in window) {
            try {
                const sensor = new AbsoluteOrientationSensor({ frequency: 60 });
                sensor.addEventListener('reading', () => {
                    const quaternion = sensor.quaternionData;
                    this.updateSensorData(quaternion);
                });
                sensor.start();
            } catch (e) {
                console.debug('[AeroVectorHUD] AbsoluteOrientationSensor unavailable, falling back to deviceorientation');
                this.initDeviceOrientation();
            }
        } else {
            this.initDeviceOrientation();
        }
    }

    initDeviceOrientation() {
        window.addEventListener('deviceorientation', (event) => {
            this._sensorData.alpha = event.alpha || 0;
            this._sensorData.beta = event.beta || 0;
            this._sensorData.gamma = event.gamma || 0;
            this._sensorData.heading = 360 - event.alpha;
        });
    }

    updateSensorData(quaternion) {
        // Convert quaternion to Euler angles
        const [x, y, z, w] = quaternion;
        const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
        const pitch = Math.asin(2 * (w * y - z * x));
        const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));

        this._sensorData.roll = roll * 180 / Math.PI;
        this._sensorData.pitch = pitch * 180 / Math.PI;
        this._sensorData.heading = (yaw * 180 / Math.PI + 360) % 360;
    }

    startRenderLoop() {
        const render = () => {
            const now = performance.now();
            if (now - this.lastRenderTime >= this.renderInterval) {
                this.render();
                this.lastRenderTime = now;
            }
            this.animationId = requestAnimationFrame(render);
        };
        render();
    }

    stopRenderLoop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    render() {
        // Update sensor data from core state
        const coreState = window.__METEO_CORE_STATE || {};
        this._sensorData.speed = coreState.speed || 0;
        this._sensorData.altitude = coreState.altitude;
        this._sensorData.heading = coreState.gnssHeading !== null ? coreState.gnssHeading : this._sensorData.heading;

        // Render all visualizations
        this.renderCompassRing();
        this.renderHorizonLayer();
        this.renderWindVector();
        this.updateMetrics();
    }

    renderCompassRing() {
        if (!this.compassCtx || !this.compassCanvas) return;

        const ctx = this.compassCtx;
        const w = this.compassCanvas.width;
        const h = this.compassCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 10;

        ctx.clearRect(0, 0, w, h);

        // Draw outer ring
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Draw cardinal directions
        const directions = ['N', 'E', 'S', 'W'];
        const angles = [0, 90, 180, 270];
        
        ctx.fillStyle = '#14b8a6';
        ctx.font = 'bold 14px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        angles.forEach((angle, i) => {
            const rad = (angle - this._sensorData.heading) * Math.PI / 180;
            const x = cx + Math.sin(rad) * (radius - 20);
            const y = cy - Math.cos(rad) * (radius - 20);
            ctx.fillText(directions[i], x, y);
        });

        // Draw heading indicator
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius + 5);
        ctx.lineTo(cx - 8, cy - radius + 20);
        ctx.lineTo(cx + 8, cy - radius + 20);
        ctx.closePath();
        ctx.fill();

        // Update heading text
        const headingDeg = Math.round(this._sensorData.heading) % 360;
        const directions_map = { 'N': [0, 360], 'NE': [45], 'E': [90], 'SE': [135], 'S': [180], 'SW': [225], 'W': [270], 'NW': [315] };
        let headingText = 'N';
        for (const [dir, angles] of Object.entries(directions_map)) {
            const diff = Math.min(...angles.map(a => Math.abs(a - headingDeg)));
            if (diff < 22.5) {
                headingText = dir;
                break;
            }
        }
        
        document.getElementById('aero-heading-deg').textContent = `${headingDeg.toString().padStart(3, '0')}°`;
        document.getElementById('aero-heading-text').textContent = headingText;
    }

    renderHorizonLayer() {
        if (!this.horizonCtx || !this.horizonCanvas) return;

        const ctx = this.horizonCtx;
        const w = this.horizonCanvas.width;
        const h = this.horizonCanvas.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.clearRect(0, 0, w, h);

        // Draw sky and ground
        const pitch = this._sensorData.pitch || 0;
        const roll = this._sensorData.roll || 0;

        // Sky (blue)
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(0, 0, w, cy);

        // Ground (brown)
        ctx.fillStyle = '#92400e';
        ctx.fillRect(0, cy, w, h);

        // Draw horizon line with pitch
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(roll * Math.PI / 180);

        const horizonY = -pitch * h / 90;
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-w, horizonY);
        ctx.lineTo(w, horizonY);
        ctx.stroke();

        // Draw pitch reference lines
        ctx.strokeStyle = '#a3a3a3';
        ctx.lineWidth = 1;
        for (let i = -4; i <= 4; i++) {
            if (i === 0) continue;
            const y = i * h / 9;
            ctx.beginPath();
            ctx.moveTo(-30, y);
            ctx.lineTo(30, y);
            ctx.stroke();
        }

        ctx.restore();

        // Draw indicator
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx + 10, cy);
        ctx.lineTo(cx, cy + 5);
        ctx.closePath();
        ctx.fill();

        document.getElementById('aero-pitch').textContent = Math.round(pitch).toString().padStart(2, '0');
        document.getElementById('aero-roll').textContent = Math.round(roll).toString().padStart(2, '0');
    }

    renderWindVector() {
        if (!this.windCtx || !this.windCanvas) return;

        const ctx = this.windCtx;
        const w = this.windCanvas.width;
        const h = this.windCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 20;

        ctx.clearRect(0, 0, w, h);

        // Draw compass circle
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Get wind data from core state
        const coreState = window.__METEO_CORE_STATE || {};
        const windDir = coreState.windDir || 0;
        const windSpeed = coreState.windSpeed || 0;
        const speed = coreState.speed || 0;

        // Calculate wind vector relative to heading
        const relativeWindDir = (windDir - this._sensorData.heading + 360) % 360;
        const windRad = relativeWindDir * Math.PI / 180;

        // Draw wind vector
        const windMagnitude = Math.min(windSpeed / 30 * radius, radius);
        const windX = Math.sin(windRad) * windMagnitude;
        const windY = -Math.cos(windRad) * windMagnitude;

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + windX, cy + windY);
        ctx.stroke();

        // Draw wind arrow
        const arrowLen = 10;
        const angle = Math.atan2(windY, windX);
        ctx.beginPath();
        ctx.moveTo(cx + windX, cy + windY);
        ctx.lineTo(cx + windX - arrowLen * Math.cos(angle - Math.PI / 6), cy + windY - arrowLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(cx + windX - arrowLen * Math.cos(angle + Math.PI / 6), cy + windY - arrowLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        // Draw speed vector (aircraft heading)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        const speedMagnitude = Math.min(speed / 30 * radius, radius);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy - speedMagnitude);
        ctx.stroke();
        ctx.setLineDash([]);

        // Calculate wind decomposition
        const headwind = windSpeed * Math.cos((windDir - this._sensorData.heading) * Math.PI / 180);
        const crosswind = windSpeed * Math.sin((windDir - this._sensorData.heading) * Math.PI / 180);

        document.getElementById('aero-headwind').textContent = Math.round(Math.max(0, headwind));
        document.getElementById('aero-crosswind').textContent = Math.round(Math.abs(crosswind));
    }

    updateMetrics() {
        const coreState = window.__METEO_CORE_STATE || {};

        document.getElementById('aero-speed').textContent = Math.round(coreState.speed || 0);
        document.getElementById('aero-altitude').textContent = coreState.altitude !== null ? Math.round(coreState.altitude) : '--';
        document.getElementById('aero-wind').textContent = Math.round(coreState.windSpeed || 0);
        document.getElementById('aero-winddir').textContent = coreState.windDir !== null ? Math.round(coreState.windDir).toString().padStart(3, '0') : '--';
    }

    toggleFullScreen() {
        const section = document.getElementById('sec-aero');
        if (!section) return;

        this.isFullScreen = !this.isFullScreen;
        
        if (this.isFullScreen) {
            section.classList.add('section-fullscreen');
            document.getElementById('icon-sec-aero').classList.replace('fa-expand', 'fa-compress');
        } else {
            section.classList.remove('section-fullscreen');
            document.getElementById('icon-sec-aero').classList.replace('fa-compress', 'fa-expand');
        }
    }

    loadConfig() {
        // Load any persisted Aero HUD config if needed
        return Promise.resolve();
    }
}
