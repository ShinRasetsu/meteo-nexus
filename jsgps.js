import { state } from './state.js';
import { toKph } from './utils.js';

export function initGPS(callback){
  if(!navigator.geolocation) return;

  state.watchId = navigator.geolocation.watchPosition(
    pos=>{
      state.currentMotion.lat = pos.coords.latitude;
      state.currentMotion.lon = pos.coords.longitude;

      state.currentMotion.speedKph = toKph(pos.coords.speed);
      state.currentMotion.gpsHeading = pos.coords.heading;

      if(state.currentMotion.speedKph > state.maxSpeed){
        state.maxSpeed = state.currentMotion.speedKph;
      }

      state.speedHistory.push(state.currentMotion.speedKph);
      if(state.speedHistory.length > 60){
        state.speedHistory.shift();
      }

      callback();
    },
    err=>console.log(err),
    { enableHighAccuracy:true }
  );
}