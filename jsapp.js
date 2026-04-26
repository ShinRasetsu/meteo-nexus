// ==========================================
// APP.JS - UI Controllers, Charting, Event Listeners
// ==========================================
import { state, CONFIG, getWindDir } from './core.js';
import { initAuth, doLogin, doRegister, doLogout, initGPS, initSensors, fetchWeather } from './services.js';

export function updateUI(data){
  if(!data) {
    const statusText = document.getElementById('status-text');
    if(statusText) statusText.innerText = "ERR_NO_DATA";
    return;
  }
  
  const tempText = data.isFallback ? `${data.temperature_2m}°C (GRID)` : `${data.temperature_2m}°C`;
  
  // Core Telemetry
  const elStatus = document.getElementById('status-text');
  if(elStatus) elStatus.innerText = tempText;
  
  const elSpeed = document.getElementById('hud-speed');
  if(elSpeed) elSpeed.innerText = state.currentMotion.speedKph.toFixed(1);
  
  const elMax = document.getElementById('hud-max');
  if(elMax) elMax.innerText = state.maxSpeed.toFixed(1);

  // Extended Telemetry
  const elWind = document.getElementById('wind-dir');
  if(elWind && data.winddirection_10m !== undefined) {
    elWind.innerText = getWindDir(data.winddirection_10m);
  }

  const elWeatherCode = document.getElementById('weather-desc');
  if(elWeatherCode && data.weather_code !== undefined) {
    // Assuming weather code mapping happens here or is passed pre-mapped
    elWeatherCode.innerText = `Condition Code: ${data.weather_code}`;
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
        plugins: {
            legend: { display: false }
        }
    }
  });
}

export function setDestination(lat, lon, name){
  state.destination = { lat, lon, name };
  localStorage.setItem('ms_dest', JSON.stringify(state.destination));
}

export function clearDestination(){
  state.destination = null;
  localStorage.removeItem('ms_dest');
}

function boot(){
  initSensors();
  initGPS(async () => {
    const data = await fetchWeather();
    updateUI(data);
  });
}

// ------------------------------------------
// DOM EVENT BINDINGS
// ------------------------------------------

// Authentication Controllers
document.getElementById('btn-login')?.addEventListener('click', async () => {
  const emailInput = document.getElementById('login-email') || document.getElementById('auth-email');
  const passInput = document.getElementById('login-pass') || document.getElementById('auth-password');
  if(emailInput && passInput) {
      await doLogin(emailInput.value, passInput.value);
  }
});

document.getElementById('btn-register')?.addEventListener('click', async () => {
  const emailInput = document.getElementById('login-email') || document.getElementById('auth-email');
  const passInput = document.getElementById('login-pass') || document.getElementById('auth-password');
  if(emailInput && passInput) {
      await doRegister(emailInput.value, passInput.value);
  }
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  await doLogout();
});

// Hardware/Trip Reset Controllers
document.getElementById('btn-reset-trip')?.addEventListener('click', () => {
    state.maxSpeed = 0; 
    state.speedHistory = [];
    localStorage.removeItem('ms_maxSpeed');
    localStorage.removeItem('ms_speedHistory');
    
    const elSpeed = document.getElementById('hud-speed');
    const elMax = document.getElementById('hud-max');
    if(elSpeed) elSpeed.innerText = "0.0";
    if(elMax) elMax.innerText = "0.0";
});

// Navigation Controllers
document.getElementById('btn-manual-loc')?.addEventListener('click', async () => {
    const latInput = document.getElementById('manual-lat');
    const lonInput = document.getElementById('manual-lon');
    
    if(latInput && lonInput && latInput.value && lonInput.value) {
        state.mode = 'manual';
        state.coords = { lat: parseFloat(latInput.value), lon: parseFloat(lonInput.value) };
        localStorage.setItem('ms_mode', 'manual');
        localStorage.setItem('ms_coords', JSON.stringify(state.coords));
        
        state.currentMotion.lat = state.coords.lat;
        state.currentMotion.lon = state.coords.lon;
        
        const data = await fetchWeather();
        updateUI(data);
    }
});

document.getElementById('btn-auto-loc')?.addEventListener('click', () => {
    localStorage.removeItem('ms_mode');
    state.mode = 'auto';
    state.autoCoords = null;
    
    const destEl = document.getElementById('search-dest');
    if(destEl) destEl.value = '';
    clearDestination();
    
    boot();
});

// Authentication State Manager
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