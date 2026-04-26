// ==========================================
// SERVICES.JS - APIs, Authentication, GPS, Audio
// ==========================================
import { CONFIG, SUPABASE_CONFIG, state, toKph, getDistKm } from './core.js';

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

export async function fetchGridFallback(lat, lon, radiusKm) {
  const offsets = [
    { dLat: radiusKm / 111.32, dLon: 0 }, 
    { dLat: -(radiusKm / 111.32), dLon: 0 }, 
    { dLat: 0, dLon: radiusKm / (111.32 * Math.cos(lat * (Math.PI / 180))) }, 
    { dLat: 0, dLon: -(radiusKm / (111.32 * Math.cos(lat * (Math.PI / 180)))) } 
  ];

  for (const offset of offsets) {
    const gridLat = lat + offset.dLat;
    const gridLon = lon + offset.dLon;
    
    try {
      const url = `${CONFIG.weatherApi}?latitude=${gridLat}&longitude=${gridLon}&current=temperature_2m,weather_code`;
      const res = await fetch(url);
      if (!res.ok) continue;
      
      const data = await res.json();
      if (data && data.current) {
        console.log(`[Telemetry] Primary failed. Fallback successful at offset: ${getDistKm(lat, lon, gridLat, gridLon).toFixed(2)}km`);
        data.current.isFallback = true; 
        return data.current;
      }
    } catch (e) {
      console.error("[Telemetry] Grid node fetch failed:", e);
    }
  }
  
  return null; 
}

export async function fetchWeather(){
  if(!state.currentMotion.lat) return null;
  
  try {
    const url = `${CONFIG.weatherApi}?latitude=${state.currentMotion.lat}&longitude=${state.currentMotion.lon}&current=temperature_2m,weather_code`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Primary API response invalid");
    
    const data = await res.json();
    if (!data.current) throw new Error("Missing current weather data");
    
    data.current.isFallback = false;
    return data.current;
  } catch (err) {
    console.warn("[Telemetry] Primary weather fetch failed, initiating grid fallback sequence...", err);
    return await fetchGridFallback(state.currentMotion.lat, state.currentMotion.lon, CONFIG.gridDistanceDeltaKm);
  }
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