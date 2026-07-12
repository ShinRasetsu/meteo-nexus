// ============================================================
// METEONEXUS - ROUTE NODE CALCULATOR
// ============================================================

function fastDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 +
            c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

export function calculateRouteNodes(
  totalDistance: number,
  coords: { lat: number; lng?: number; lon?: number }[],
  intervalDist: number
): { lat: number; lon: number; id: number; passed: boolean }[] {
  if (!coords || coords.length === 0) return [];

  const totalFutureNodesCount = Math.floor(totalDistance / intervalDist);
  const nodes = new Array(totalFutureNodesCount);

  let cumulativeDistances = new Float32Array(coords.length);
  cumulativeDistances[0] = 0;
  for (let j = 1; j < coords.length; j++) {
    const lonPrev = coords[j-1].lng !== undefined ? coords[j-1].lng! : coords[j-1].lon!;
    const lonCurr = coords[j].lng !== undefined ? coords[j].lng! : coords[j].lon!;
    cumulativeDistances[j] = cumulativeDistances[j-1] + fastDistance(coords[j-1].lat, lonPrev, coords[j].lat, lonCurr);
  }

  let searchIdx = 1;
  let validNodeCount = 0;

  for (let i = 1; i <= totalFutureNodesCount; i++) {
    const targetDist = i * intervalDist;

    while (searchIdx < coords.length && cumulativeDistances[searchIdx] < targetDist) {
      searchIdx++;
    }

    if (searchIdx < coords.length) {
      const p1 = coords[searchIdx - 1];
      const p2 = coords[searchIdx];
      const lon1 = p1.lng !== undefined ? p1.lng! : p1.lon!;
      const lon2 = p2.lng !== undefined ? p2.lng! : p2.lon!;

      const segmentDist = cumulativeDistances[searchIdx] - cumulativeDistances[searchIdx - 1];
      const excessDist = targetDist - cumulativeDistances[searchIdx - 1];
      const ratio = segmentDist === 0 ? 0 : excessDist / segmentDist;

      nodes[validNodeCount++] = {
        lat: p1.lat + (p2.lat - p1.lat) * ratio,
        lon: lon1 + (lon2 - lon1) * ratio,
        id: i,
        passed: false
      };
    }
  }

  // Zero-allocation truncation: Avoids `.filter()` overhead and prevents GC pauses
  nodes.length = validNodeCount;
  return nodes;
}