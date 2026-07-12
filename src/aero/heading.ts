// ============================================================
// METEONEXUS - AERO HUD: HEADING FUSION & CALIBRATION
// ============================================================

import { WeatherEnsemble } from '../ensemble/ensemble.js';
import { CARDINAL_LUT, getCardinalStr } from '../config.js';

interface CoreState {
  fusedHeading: number | null;
  gnssHeading: number | null;
  lastGnssUpdate: number;
  deviceHeading: number | null;
  windSpeed: number | null;
  windDir: number | null;
  windGust: number | null;
  altitude: number | null;
  topoAltitude: number | null;
  speed: number | null;
  quaternionActive: boolean;
  pitch: number;
  roll: number;
}

const HEADING_DEADBAND = 2.0;
const CALIB_VARIANCE_THRESHOLD = 25;
const CALIB_HISTORY_LENGTH = 50;
const HEADING_TC = { fused: 100, gnss: 200, imu: 500 };

let lastRawHeading: number | null = null;

export function handleOrientationUpdate(alphaOrHeading: number) {
  const core = (window as any).__METEO_CORE_STATE;
  if (lastRawHeading === null) {
    lastRawHeading = alphaOrHeading;
    core.rawSensorHeading = alphaOrHeading;
  } else {
    let diff = alphaOrHeading - lastRawHeading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) >= 2.0) {
      lastRawHeading = alphaOrHeading;
      core.rawSensorHeading = alphaOrHeading;
    }
  }
}

export function computeRobustHeading(alpha: number, beta: number, gamma: number): number {
  const rad = Math.PI / 180;
  const a = alpha * rad, b = beta * rad, g = gamma * rad;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b);
  const cG = Math.cos(g), sG = Math.sin(g);
  const yX = -sA * cB, yY = cA * cB;
  const zX = -cA * sG - sA * Math.sin(b) * cG;
  const zY = -sA * sG + cA * Math.sin(b) * cG;
  const wY = Math.abs(Math.cos(b)), wZ = Math.abs(Math.sin(b));
  const dirX = yX * wY + zX * wZ, dirY = yY * wY + zY * wZ;
  let heading = Math.atan2(dirX, dirY) * (180 / Math.PI);
  if (heading < 0) heading += 360;
  return heading;
}

export function initDeviceOrientationListeners(core: CoreState) {
  if ('AbsoluteOrientationSensor' in window) {
    try {
      const perms = await Promise.all([
        navigator.permissions.query({ name: 'accelerometer' }),
        navigator.permissions.query({ name: 'magnetometer' }),
        navigator.permissions.query({ name: 'gyroscope' })
      ]);
      if (perms.every(p => p.state !== 'denied')) {
        const sensor = new AbsoluteOrientationSensor({ frequency: 60 });
        sensor.addEventListener('reading', () => {
          core.quaternionActive = true;
          const q = sensor.quaternion;
          const vx = -2 * (q[0] * q[2] + q[3] * q[1]);
          const vy =  2 * (q[3] * q[0] - q[1] * q[2]);
          let heading = Math.atan2(vx, vy) * (180 / Math.PI);
          core.deviceHeading = (heading + 360) % 360;
        });
        sensor.start();
      }
    } catch (e) { console.warn('AeroHUD: AbsoluteOrientationSensor unavailable:', e); }
  }

  window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
    if (e.webkitCompassHeading != null) {
      core.deviceHeading = e.webkitCompassHeading;
    } else if (e.absolute && e.alpha !== null && e.beta !== null && e.gamma !== null && !core.quaternionActive) {
      core.deviceHeading = computeRobustHeading(e.alpha, e.beta, e.gamma);
    }
    if (e.beta !== null && e.gamma !== null) {
      const rad = Math.PI / 180;
      const b = e.beta * rad, g = e.gamma * rad;
      const gx = Math.cos(b) * Math.sin(g);
      const gy = Math.sin(b);
      const gz = Math.cos(b) * Math.cos(g);
      core.roll  = Math.atan2(gx, gy) * (180 / Math.PI);
      core.pitch = Math.asin(Math.max(-1, Math.min(1, gz))) * (180 / Math.PI);
    }
  });

  window.addEventListener('deviceorientationabsolute', (e: DeviceOrientationEvent) => {
    if (e.alpha !== null && !core.quaternionActive) {
      core.deviceHeading = computeRobustHeading(e.alpha, e.beta ?? 0, e.gamma ?? 0);
    }
    if (e.beta !== null && e.gamma !== null) {
      const rad = Math.PI / 180;
      const b = e.beta * rad, g = e.gamma * rad;
      const gx = Math.cos(b) * Math.sin(g);
      const gy = Math.sin(b);
      const gz = Math.cos(b) * Math.cos(g);
      core.roll  = Math.atan2(gx, gy) * (180 / Math.PI);
      core.pitch = Math.asin(Math.max(-1, Math.min(1, gz))) * (180 / Math.PI);
    }
  });
}

const calibHeadingBuf = new Float32Array(50);
let calibBufIdx = 0;
let calibBufFull = false;

export function renderAeroHud() {
  const core = (window as any).__METEO_CORE_STATE;
  const st = core;
  const now = Date.now();

  // Cache state reads
  const ws = st.windSpeed;
  const wg = st.windGust;
  const wd = st.windDir;
  const alt = st.altitude;
  const topoAlt = st.topoAltitude;
  const fusedHdg = st.fusedHeading;
  const gnssHdg = st.gnssHeading;
  const gnssAge = now - st.lastGnssUpdate;
  const deviceHdg = st.deviceHeading;
  const speedKmh = st.speed !== null ? st.speed * 3.6 : 0;

  // Heading priority chain
  let activeHeading = 0;
  let headingValid = false;
  let headingSource = 'none';
  let headingQuality = 0;

  if (fusedHdg !== null) {
    activeHeading = fusedHdg; headingValid = true; headingQuality = 1.0; headingSource = 'fused';
  } else if (gnssHdg !== null && gnssAge < 3000) {
    activeHeading = gnssHdg; headingValid = true; headingQuality = 0.7; headingSource = 'gnss';
  } else if (deviceHdg !== null) {
    activeHeading = deviceHdg; headingValid = true; headingQuality = 0.4; headingSource = 'imu';
  }

  // Calibration detection
  const usingMagnetometer = (headingSource === 'imu') || (headingSource === 'fused' && !st.quaternionActive);
  if (deviceHdg !== null && usingMagnetometer) {
    calibHeadingBuf[calibBufIdx] = deviceHdg;
    calibBufIdx = (calibBufIdx + 1) % 50;
    if (calibBufIdx === 0) calibBufFull = true;

    if (calibBufFull || calibBufIdx > 10) {
      let sumSin = 0, sumCos = 0, n = calibBufFull ? 50 : calibBufIdx;
      for (let i = 0; i < n; i++) {
        const rad = calibHeadingBuf[i] * (Math.PI / 180);
        sumSin += Math.sin(rad);
        sumCos += Math.cos(rad);
      }
      const meanResultant = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / n;
      const circularVariance = 1 - meanResultant;
      const varianceDeg2 = circularVariance * 360 * 360 / (4 * Math.PI);
      const magStd = Math.sqrt(varianceDeg2);
      // Update calibration UI
      const calibEl = document.getElementById('ui-radar-calibrate');
      const calibMsgEl = document.getElementById('ui-radar-calib-msg');
      if (calibEl && calibMsgEl) {
        if (varianceDeg2 > 25) {
          calibMsgEl.innerHTML = `<i class="fa-solid fa-magnet fa-spin"></i> MAG UNCALIBRATED: ${magStd.toFixed(0)}°`;
          calibMsgEl.className = 'text-brand-warning uppercase tracking-widest mt-1 opacity-0 transition-opacity drop-shadow-md flex items-center gap-1';
          calibEl.classList.remove('opacity-0');
        } else {
          calibMsgEl.innerHTML = `<i class="fa-solid fa-magnet"></i> MAG OK: ${magStd.toFixed(1)}°`;
          calibMsgEl.className = 'text-brand-success uppercase tracking-widest mt-1 opacity-0 transition-opacity drop-shadow-md flex items-center gap-1';
        }
      }
    }
  }

  // Render logic would go here - using DOM elements from mountAeroUI
  // This is the 60fps render loop
  requestAnimationFrame(renderAeroHud);
}

export function mountAeroUI() {
  setTimeout(() => {
    const grids = document.querySelectorAll('.grid');
    let targetGrid = null;
    grids.forEach(g => { if (g.className.includes('grid-cols') && g.className.includes('gap')) targetGrid = g; });
    if (!targetGrid && grids.length > 0) targetGrid = grids[0];
    if (!targetGrid) return;

    const aeroContainer = document.createElement('div');
    aeroContainer.className = "lg:col-span-12 w-full mt-2";

    const radarCard = document.createElement('div');
    radarCard.className = "bg-surface-900 border-4 border-surface-800 rounded-2xl p-4 flex flex-col justify-center items-center relative overflow-hidden min-h-[220px] transition-all duration-300";
    radarCard.innerHTML = `
      <div class="absolute top-3 left-4 flex justify-between items-start w-[calc(100%-2rem)] z-30 pointer-events-none">
        <div class="flex flex-col">
          <span class="text-sm font-bold tracking-widest uppercase text-brand-teal"><i class="fa-solid fa-jet-fighter mr-2"></i> Aero-Vector HUD</span>
          <span id="ui-radar-gust" class="text-[10px] font-black text-brand-red uppercase tracking-widest mt-1 opacity-0 transition-opacity drop-shadow-md">GUST WARNING</span>
          <span id="ui-radar-calibrate" class="text-[10px] font-black text-brand-orange uppercase tracking-widest mt-1 opacity-0 transition-opacity drop-shadow-md flex items-center gap-1">
            <i class="fa-solid fa-magnet fa-spin"></i> <span id="ui-radar-calib-msg">CALIBRATE: FIGURE-8</span>
          </span>
        </div>
        <div class="flex items-start gap-4">
          <div class="text-right pointer-events-none">
            <span class="text-[10px] font-bold text-brand-orange uppercase tracking-widest block mb-0.5">ALTIMETER</span>
            <div class="flex items-baseline gap-1 justify-end" id="ui-radar-alt-container">
              <span id="ui-radar-alt" class="font-mono text-lg font-black text-brand-orange drop-shadow-md">--</span>
              <span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest">m</span>
            </div>
          </div>
          <button id="radar-expand-btn" class="text-brand-teal hover:text-white transition-colors p-2 bg-surface-800 border-2 border-surface-700 rounded-lg flex items-center justify-center pointer-events-auto shadow-sm">
            <i class="fa-solid fa-expand text-base"></i>
          </button>
        </div>
      </div>

      <div id="radar-dial-scaler" class="relative w-44 h-44 mt-6 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-center">
        <div id="ui-radar-ring" class="absolute inset-0 rounded-full border-[3px] border-surface-700/80 pointer-events-none shadow-[inset_0_0_15px_rgba(0,0,0,0.4)] z-10">
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
        <div id="ui-radar-wind-layer" class="absolute inset-0 flex items-start justify-center z-30 pointer-events-none">
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
            <span id="ui-radar-crosswind">CRS: 0</span>
            <span class="text-surface-600">|</span>
            <span id="ui-radar-headwind">HWD: 0</span>
          </div>
        </div>
      </div>
    `;

    aeroContainer.appendChild(radarCard);
    targetGrid.appendChild(aeroContainer);

    // Store element references
    const _el = {
      ring:         document.getElementById('ui-radar-ring'),
      wind:         document.getElementById('ui-radar-wind-layer'),
      relAngle:     document.getElementById('ui-radar-rel-angle'),
      windSpeed:    document.getElementById('ui-radar-wind-speed'),
      altContainer: document.getElementById('ui-radar-alt-container'),
      gust:         document.getElementById('ui-radar-gust'),
      cross:        document.getElementById('ui-radar-crosswind'),
      head:         document.getElementById('ui-radar-headwind'),
      ghost: [
        document.getElementById('ui-radar-wind-ghost-1'),
        document.getElementById('ui-radar-wind-ghost-2'),
        document.getElementById('ui-radar-wind-ghost-3')
      ],
      calib:        document.getElementById('ui-radar-calibrate'),
      calibMsg:     document.getElementById('ui-radar-calib-msg')
    };

    const expandBtn  = radarCard.querySelector('#radar-expand-btn') as HTMLButtonElement;
    const dialScaler = radarCard.querySelector('#radar-dial-scaler') as HTMLElement;
    let isRadarFullscreen = false;
    expandBtn.addEventListener('click', () => {
      isRadarFullscreen = !isRadarFullscreen;
      if (isRadarFullscreen) {
        radarCard.classList.add('fixed', 'inset-0', 'z-[9999]', 'h-[100dvh]', 'rounded-none', 'bg-surface-900/95', 'backdrop-blur-md');
        radarCard.classList.remove('relative', 'rounded-2xl', 'min-h-[220px]', 'bg-surface-900', 'border-4');
        const minDim = Math.min(window.innerWidth, window.innerHeight);
        const scale  = (minDim * 0.6) / 160;
        dialScaler.style.transform = `scale(${scale})`;
        expandBtn.innerHTML = '<i class="fa-solid fa-compress text-base"></i>';
        document.body.classList.add('overflow-hidden');
      } else {
        radarCard.classList.remove('fixed', 'inset-0', 'z-[9999]', 'h-[100dvh]', 'rounded-none', 'bg-surface-900/95', 'backdrop-blur-md');
        radarCard.classList.add('relative', 'rounded-2xl', 'min-h-[220px]', 'bg-surface-900', 'border-4');
        dialScaler.style.transform = 'scale(1)';
        expandBtn.innerHTML = '<i class="fa-solid fa-expand text-base"></i>';
        document.body.classList.remove('overflow-hidden');
      }
    });

    requestAnimationFrame(renderAeroHud);
  }, 1000);
}