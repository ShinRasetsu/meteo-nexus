import { CONFIG } from './config.js';
import { state } from './state.js';

export async function fetchWeather(){
  if(!state.currentMotion.lat) return null;

  const url = `${CONFIG.weatherApi}?latitude=${state.currentMotion.lat}&longitude=${state.currentMotion.lon}&current=temperature_2m,weather_code`;

  const res = await fetch(url);
  const data = await res.json();

  return data.current;
}