import { state } from './state.js';

export function playSonar(){
  if(!state.audioEnabled) return;

  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  gain.gain.setValueAtTime(0.5, ctx.currentTime);

  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}