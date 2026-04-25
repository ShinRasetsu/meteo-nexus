export function getWindDir(d) {
  if (d === null) return '—';
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(d/45)%8];
}

export function getDistKm(a,b,c,d){
  const R=6371;
  const dA=(c-a)*Math.PI/180;
  const dB=(d-b)*Math.PI/180;

  const x=Math.sin(dA/2)**2 +
    Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180) *
    Math.sin(dB/2)**2;

  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

export function toKph(ms){
  return ms ? ms * 3.6 : 0;
}