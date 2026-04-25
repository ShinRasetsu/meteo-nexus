// ==========================================
// SERVICES.JS - APIs, Authentication, GPS, Audio
// ==========================================
import { CONFIG, SUPABASE_CONFIG, state, toKph } from './core.js';

const { createClient } = window.supabase;
export const sb = createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.KEY);

export async function doLogin(email, password){
  return await sb.auth.signInWithPassword({ email, password });
}

export async function doRegister(email, password){
  return await sb.auth.signUp({ email, password });
}

export async function doLogout(){
  return await sb.auth.signOut();
}

export function initAuth(onLogin, onLogout){
  sb.auth.getSession().then(({ data: { session } }) => {
    if(session?.user) onLogin(session.user);
    else onLogout();
  });
  sb.auth.onAuthStateChange((event, session) => {
    if(session?.user) onLogin(session.user);
    else onLogout();
  });
}

export async function fetchWeather(){
  if(!state.currentMotion.lat) return null;
  const url = `${CONFIG.weatherApi}?latitude=${state.currentMotion.lat}&longitude=${state.currentMotion.lon}&current=temperature_2m,weather_code`;
  const res = await fetch(url);
  const data = await res.json();
  return data.current;
}

export function initGPS(callback){
  if(!navigator.geolocation) return;
  state.watchId = navigator.geolocation.watchPosition(
    pos => {
      state.currentMotion.lat = pos.coords.latitude;
      state.currentMotion.lon = pos.coords.longitude;
      state.currentMotion.speedKph = toKph(pos.coords.speed);
      state.currentMotion.gpsHeading = pos.coords.heading;

      if(state.currentMotion.speedKph > state.maxSpeed){
        state.maxSpeed = state.currentMotion.speedKph;
      }

      state.speedHistory.push(state.currentMotion.speedKph);
      if(state.speedHistory.length > CONFIG.speedHistoryMaxSamples){
        state.speedHistory.shift();
      }
      callback();
    },
    err => console.error("GPS Error:", err),
    { enableHighAccuracy: true }
  );
}

export function initSensors(){
  window.addEventListener('deviceorientation', e => {
    if(e.alpha !== null){
      state.magHeading = 360 - e.alpha;
    }
  });
}

export function playSonar(){
  if(!state.audioEnabled) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  gain.gain.setValueAtTime(0.5, ctx.currentTime);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}