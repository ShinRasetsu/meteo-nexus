// ============================================================
// METEONEXUS - AERO HUD: RENDER LOOP
// ============================================================

import { WeatherEnsemble } from '../../ensemble/ensemble.js';
import { CARDINAL_LUT } from '../../config.js';
import { fastDistance } from '../utils/math.js';

let visualHeading: number | null = null;
let visualWindAngle: number | null = null;
let lastRenderTime = performance.now();

const windHistory = new Float32Array([-1, -1, -1]);
let historyIdx = 0;
let lastHistoryTime = 0;

const _uiCache: Record<string, string> = {
  alt: '', windSpeed: '', gust: 'hidden',
  ringTrans: '', relAngle: '',
  windTrans: '', head: '', cross: ''
};

export function renderAeroHud(): void {
  const frameNow = performance.now();
  const dt = Math.min(frameNow - lastRenderTime, 100);
  lastRenderTime = frameNow;

  requestAnimationFrame(renderAeroHud);
  const st = (window as any).__METEO_CORE_STATE;
  if (!st || !st.fusedHeading && !st.gnssHeading && !st.deviceHeading) return;

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

  let activeHeading = 0;
  let headingValid = false;
  let headingQuality = 0;
  let headingSource = 'none';

  if (fusedHdg !== null) {
    activeHeading = fusedHdg; headingValid = true; headingQuality = 1.0; headingSource = 'fused';
  } else if (gnssHdg !== null && gnssAge < 3000) {
    activeHeading = gnssHdg; headingValid = true; headingQuality = 0.7; headingSource = 'gnss';
  } else if (deviceHdg !== null) {
    activeHeading = deviceHdg; headingValid = true; headingQuality = 0.4; headingSource = 'imu';
  }

  // ALTIMETER
  if (alt !== null) {
    document.getElementById('ui-radar-alt')!.innerHTML = `${Math.round(alt)}<span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest ml-1">m</span>`;
  } else if (topoAlt !== null) {
    document.getElementById('ui-radar-alt')!.innerHTML = `${Math.round(topoAlt)}<span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest ml-1">m (TOPO)</span>`;
  } else {
    document.getElementById('ui-radar-alt')!.innerHTML = `<span class="bg-surface-700 text-brand-orange text-[9px] px-1.5 py-0.5 rounded uppercase tracking-widest border border-surface-600">2D FIX</span>`;
  }

  // WIND SPEED
  if (ws !== null) {
    const wsStr = Math.round(ws).toString();
    document.getElementById('ui-radar-wind-speed')!.textContent = wsStr;
  }

  // GUST BOUNDARY
  if (wg > 0 && ws !== null) {
    const gustDiff = wg - ws;
    const gStr = gustDiff >= 5 ? `GUST +${Math.round(gustDiff)}` : 'hidden';
    const gustEl = document.getElementById('ui-radar-gust')!;
    if (gStr === 'hidden') { gustEl.classList.add('opacity-0'); }
    else { gustEl.classList.remove('opacity-0'); gustEl.textContent = gStr; }
  }

  // HEADING PRIORITY CHAIN
  if (headingValid) {
    if (visualHeading === null) visualHeading = activeHeading;
    else {
      let hdiff = activeHeading - visualHeading;
      if (hdiff > 180) hdiff -= 360;
      if (hdiff < -180) hdiff += 360;
      const lerpA = 1 - Math.exp(-dt / (headingQuality > 0.8 ? 80 : 120));
      visualHeading = (visualHeading + hdiff * lerpA + 360) % 360;
    }
    const ringT = `rotate(${-visualHeading}deg)`;
    document.getElementById('ui-radar-ring')!.style.transform = ringT;
  }

  // WIND VECTOR
  if (headingValid && wd !== null && ws !== null) {
    const relAngle = (wd - activeHeading + 360) % 360;

    const relStr = `${relAngle.toFixed(0)}<span class="text-[12px] font-bold text-gray-500 ml-1.5 tracking-widest leading-none">&deg; ${getCardinalStr(wd)}</span>`;
    document.getElementById('ui-radar-rel-angle')!.innerHTML = relStr;

    if (visualWindAngle === null) visualWindAngle = relAngle;
    else {
      let wdiff = relAngle - visualWindAngle;
      if (wdiff > 180) wdiff -= 360;
      if (wdiff < -180) wdiff += 360;
      const lerpW = 1 - Math.exp(-dt / 300);
      visualWindAngle = (visualWindAngle + wdiff * lerpW + 360) % 360;
    }
    document.getElementById('ui-radar-wind-layer')!.style.transform = `rotate(${visualWindAngle.toFixed(1)}deg)`;

    // Vector decomposition
    const rad = relAngle * (Math.PI / 180);
    const headForce = Math.cos(rad) * ws;
    const crossForce = Math.sin(rad) * ws;

    const hStr = `<span class="${headForce > 0 ? 'text-brand-orange' : 'text-brand-success'}">${headForce > 0 ? 'HWD' : 'TAL'}: ${Math.abs(headForce).toFixed(0)}</span>`;
    document.getElementById('ui-radar-headwind')!.innerHTML = hStr;

    const cStr = `CRS: ${Math.abs(crossForce).toFixed(0)} <i class="fa-solid fa-arrow-${crossForce > 0 ? 'left' : 'right'}"></i>`;
    document.getElementById('ui-radar-crosswind')!.innerHTML = cStr;

    // History trail
    if (now - lastHistoryTime > 10000) {
      if (!isNaN(relAngle)) windHistory[historyIdx] = relAngle;
      historyIdx = (historyIdx + 1) % 3;
      lastHistoryTime = now;
    }
    for (let i = 0; i < 3; i++) {
      const age = (historyIdx - 1 - i + 3) % 3;
      const histAngle = windHistory[age];
      if (histAngle !== -1 && !isNaN(histAngle)) {
        document.getElementById(`ui-radar-wind-ghost-${i+1}`)!.style.transform = `rotate(${histAngle.toFixed(1)}deg)`;
      }
    }
  }
}