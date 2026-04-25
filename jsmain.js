import { initAuth } from './auth.js';
import { initGPS } from './gps.js';
import { fetchWeather } from './weather.js';
import { updateUI } from './ui.js';

function boot(){
  initGPS(async ()=>{
    const data = await fetchWeather();
    updateUI(data);
  });
}

// AUTH FLOW
initAuth(
  (user)=>{
    document.getElementById('auth-overlay').style.display='none';
    document.getElementById('app').style.display='block';
    boot();
  },
  ()=>{
    document.getElementById('auth-overlay').style.display='block';
    document.getElementById('app').style.display='none';
  }
);