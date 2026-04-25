import { state } from './state.js';

export function initSensors(){
  window.addEventListener('deviceorientation', e=>{
    if(e.alpha !== null){
      state.magHeading = 360 - e.alpha;
    }
  });
}