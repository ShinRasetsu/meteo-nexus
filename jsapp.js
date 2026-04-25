// ==========================================
// APP.JS - UI Controllers, Charting, Event Listeners
// ==========================================
import { state } from './core.js';
import { initAuth, doLogin, doRegister, doLogout, initGPS, initSensors, fetchWeather } from './services.js';

export function updateUI(data){
  if(!data) return;
  document.getElementById('status-text').innerText = data.temperature_2m + "°C";
  document.getElementById('hud-speed').innerText = state.currentMotion.speedKph.toFixed(1);
  document.getElementById('hud-max').innerText = state.maxSpeed.toFixed(1);
}

export function renderChart(ctx, labels, data){
  if(state.chart) state.chart.destroy();
  state.chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Rain', data, borderWidth: 2 }]
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

// Main Boot Sequence
function boot(){
  initSensors();
  initGPS(async () => {
    const data = await fetchWeather();
    updateUI(data);
  });
}

// Authentication DOM Bindings
document.getElementById('btn-login')?.addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value;
  const pass = document.getElementById('auth-password').value;
  await doLogin(email, pass);
});

document.getElementById('btn-register')?.addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value;
  const pass = document.getElementById('auth-password').value;
  await doRegister(email, pass);
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  await doLogout();
});

// Authentication State Manager
initAuth(
  (user) => {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    boot();
  },
  () => {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }
);