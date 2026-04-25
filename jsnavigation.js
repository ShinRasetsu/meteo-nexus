import { state } from './state.js';

export function setDestination(lat, lon, name){
  state.destination = { lat, lon, name };
  localStorage.setItem('ms_dest', JSON.stringify(state.destination));
}

export function clearDestination(){
  state.destination = null;
  localStorage.removeItem('ms_dest');
}