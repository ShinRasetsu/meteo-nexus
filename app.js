// ==========================================
// APP.JS - UI Controllers, Charting, Event Listeners
// ==========================================
import { state, CONFIG, getWindDir } from './core.js';
import { initAuth, doLogin, doRegister, doLogout, initGPS, initSensors, fetchWeather, playSonar } from './services.js';

export function updateHUD(data = null){
  // Core Velocity Updates
  const elSpeed = document.getElementById('hud-speed');
  if(elSpeed) elSpeed.innerText = state.currentMotion.speedKph.toFixed(1);
  
  const elMax = document.getElementById('hud-max');
  if(elMax) elMax.innerText = state.maxSpeed.toFixed(1);

  if(!data || !data.current) {
    const statusText = document.getElementById('status-text');
    if(statusText) statusText.innerText = state.mode === 'auto' && !state.currentMotion.lat ? "ACQUIRING SATELLITE" : "ERR_NO_DATA";
    return;
  }
  
  const current = data.current;
  const tempText = current.isFallback ? `${current.temperature_2m}°C (GRID)` : `${current.temperature_2m}°C`;
  
  const elStatus = document.getElementById('status-text');
  if(elStatus) elStatus.innerText = tempText;

  const elWind = document.getElementById('wind-dir');
  if(elWind && current.winddirection_10m !== undefined) {
    elWind.innerText = getWindDir(current.winddirection_10m);
  }

  const elWeatherCode = document.getElementById('weather-desc');
  if(elWeatherCode && current.weather_code !== undefined) {
    elWeatherCode.innerText = `Condition Code: ${current.weather_code}`;
  }

  // Trigger Sonar on heavy rain logic if configured
  if (data.hourly && data.hourly.precipitation && data.hourly.precipitation[0] > 2.5) {
      playSonar();
  }
}

export function renderChart(ctx, labels, data){
  if(state.chart) state.chart.destroy();
  state.chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ 
        label: 'Precipitation (mm)', 
        data, 
        borderColor: '#39ff14', 
        backgroundColor: 'rgba(57, 255, 20, 0.1)',
        borderWidth: 2, 
        fill: true,
        tension: 0.3
      }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { grid: { color: '#30363d' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: '#30363d' }, ticks: { color: '#94a3b8' } }
        },
        plugins: { legend: { display: false } }
    }
  });
}

// ── TRIP / NAV RESETS ──
function resetTrip() {
    state.maxSpeed = 0; 
    state.speedHistory = [];
    localStorage.removeItem('ms_maxSpeed');
    localStorage.removeItem('ms_speedHistory');
    updateHUD();
}

function resetToAuto() {
    ['ms_mode','ms_maxSpeed','ms_speedHistory'].forEach(k => localStorage.removeItem(k));
    state.mode = 'auto'; 
    state.autoCoords = null; 
    state.lastGridFetchTime = 0;
    state.maxSpeed = 0; 
    state.speedHistory = [];
    
    const destEl = document.getElementById('search-dest');
    if (destEl) destEl.value = '';
    
    state.destination = null;
    localStorage.removeItem('ms_dest');
    
    updateHUD();
    boot();
}

function setManualLocation() {
    const latInput = document.getElementById('manual-lat');
    const lonInput = document.getElementById('manual-lon');
    
    if(latInput && lonInput && latInput.value && lonInput.value) {
        state.mode = 'manual';
        state.coords = { lat: parseFloat(latInput.value), lon: parseFloat(lonInput.value) };
        localStorage.setItem('ms_mode', 'manual');
        localStorage.setItem('ms_coords', JSON.stringify(state.coords));
        
        boot(true);
    }
}

async function boot(forceFetch = false){
  initSensors();
  
  if (state.mode === 'manual' || forceFetch) {
      const data = await fetchWeather();
      updateHUD(data);
  } else {
      initGPS(async () => {
        const data = await fetchWeather();
        updateHUD(data);
      });
  }
}

// ------------------------------------------
// DOM EVENT BINDINGS
// ------------------------------------------
document.getElementById('btn-reset-trip')?.addEventListener('click', resetTrip);
document.getElementById('btn-auto-loc')?.addEventListener('click', resetToAuto);
document.getElementById('btn-manual-loc')?.addEventListener('click', setManualLocation);

document.getElementById('btn-login')?.addEventListener('click', async () => {
  const emailInput = document.getElementById('login-email') || document.getElementById('auth-email');
  const passInput = document.getElementById('login-pass') || document.getElementById('auth-password');
  if(emailInput && passInput) {
      await doLogin(emailInput.value, passInput.value);
  }
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  await doLogout();
});

// Authentication Initialization
initAuth(
  (user) => {
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app');
    
    if(authOverlay) authOverlay.style.display = 'none';
    if(appContainer) appContainer.style.display = 'block';
    
    boot();
  },
  () => {
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app');
    
    if(authOverlay) authOverlay.style.display = 'flex';
    if(appContainer) appContainer.style.display = 'none';
  }
);