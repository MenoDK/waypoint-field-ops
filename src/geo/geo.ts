/** Plain geometry on the WGS-84 sphere. No I/O, no clock: everything here is a function of its arguments. */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088; // mean radius (IUGG)
const RAD = Math.PI / 180;

/**
 * Is this a coordinate a GPS could have produced?
 *
 * Finite numbers inside the valid ranges, and not exactly (0, 0): "Null Island" is what many receivers report when they have
 * no fix at all, so a ping there is a failed reading, not a vehicle in the Gulf of Guinea.
 */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  // min() guards against h creeping a hair above 1 for antipodal points (floating-point), which would make asin() NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, 0..360 degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Length of a polyline in kilometres. */
export function pathLengthKm(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineKm(points[i - 1]!, points[i]!);
  return total;
}

/** Percentage (0..100, integer) of the way from the start to the destination, given the straight-line figures. */
export function progressPercent(totalKm: number, remainingKm: number): number {
  if (!(totalKm > 0) || !Number.isFinite(remainingKm)) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalKm - remainingKm) / totalKm) * 100)));
}
