import { state } from './state.js';

export function updateUI(data){
  if(!data) return;

  document.getElementById('status-text').innerText =
    data.temperature_2m + "°C";

  document.getElementById('hud-speed').innerText =
    state.currentMotion.speedKph.toFixed(1);

  document.getElementById('hud-max').innerText =
    state.maxSpeed.toFixed(1);
}