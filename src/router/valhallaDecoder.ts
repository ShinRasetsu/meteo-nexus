// ============================================================
// METEONEXUS - VALHALLA DECODER
// Zero-allocation polyline decompression
// ============================================================

export function decodeValhallaPolyline(str: string): { lat: number; lng: number }[] {
  let index = 0, lat = 0, lng = 0, coordinates: { lat: number; lng: number }[] = [], shift = 0, result = 0, byte: number | null = null;
  const factor = 1e6; // Valhalla strictly uses 6 digits of precision
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));

    shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));

    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }
  return coordinates;
}