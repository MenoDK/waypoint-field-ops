import type { LatLng } from '../geo/geo';

/**
 * Protections for talking to a router that is not ours to trust (ADR 0006).
 *
 * A routing service is an outside party: it can be down, slow, wrong, or hostile. None of those may turn into a map line in the
 * wrong country, a ten-megabyte body in memory, or an ETA that is off by a factor of five. Every function here is pure so the
 * protection that is never exercised is not the one discovered broken on the day it matters.
 */

/** Largest response body read, in bytes. A route of several hundred kilometres is well under 1 MB. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Most vertices accepted in a geometry. Beyond this it is not a route, it is a defect or an attack. */
export const MAX_VERTICES = 20_000;
/** How far outside the box of the requested points a geometry may stray, in degrees (~220 km). */
export const BOX_MARGIN_DEG = 2;

const INTERNAL_SUFFIXES = [
  '.internal',
  '.local',
  '.localdomain',
  '.lan',
  '.intranet',
  '.corp',
  '.svc',
  '.home',
  '.test',
];

/**
 * A plain-text URL to a public host would send coordinates across the internet in clear. HTTPS is required for those; HTTP
 * stays valid for a router on the same machine or network (`localhost`, a private range, a bare service name such as `router`
 * on a Compose network), which is the deployment worth encouraging.
 *
 * This is a guard against a realistic slip (pasting an `http://` URL from a tutorial), not a security boundary: the URL comes
 * from the operator's environment, never from a request.
 */
export function routerUrlAcceptable(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'unsupported scheme' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const internal =
    host === 'localhost' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    !host.includes('.') ||
    INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (url.protocol === 'http:' && !internal) {
    return {
      ok: false,
      reason: 'a public host needs HTTPS: coordinates must not cross the internet in clear',
    };
  }
  return { ok: true };
}

/**
 * Returns the geometry as `LatLng[]` if it answers the question that was asked, else `null`.
 * `coordinates` is GeoJSON order: [lng, lat].
 */
export function geometryTrustworthy(coordinates: unknown, requested: readonly LatLng[]): LatLng[] | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > MAX_VERTICES) return null;
  if (requested.length === 0) return null;

  const west = Math.min(...requested.map((p) => p.lng)) - BOX_MARGIN_DEG;
  const east = Math.max(...requested.map((p) => p.lng)) + BOX_MARGIN_DEG;
  const south = Math.min(...requested.map((p) => p.lat)) - BOX_MARGIN_DEG;
  const north = Math.max(...requested.map((p) => p.lat)) + BOX_MARGIN_DEG;

  const out: LatLng[] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [lng, lat] = pair as unknown[];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat))
      return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    // One point outside the region asked about makes the whole answer suspect: drawing it would be worse than drawing nothing.
    if (lng < west || lng > east || lat < south || lat > north) return null;
    out.push({ lat, lng });
  }
  return out;
}

/**
 * Is a road distance believable next to the straight line between the same points? A road can never be shorter than the
 * straight line (a hair of tolerance for rounding) and is rarely more than a few times longer.
 */
export function roadDistancePlausible(roadKm: number, straightKm: number): boolean {
  if (!Number.isFinite(roadKm) || roadKm < 0) return false;
  // A vehicle standing on the destination: both points snap to the same spot and a road of length zero is the right answer.
  // (Anywhere else a zero-length road is a lie, and falls through to the comparison below.)
  if (roadKm === 0) return straightKm < 0.05;
  if (roadKm < straightKm * 0.98) return false;
  return roadKm <= Math.max(straightKm * 6, straightKm + 2);
}

/** Reads a response body but stops, and fails, as soon as it exceeds `maxBytes`: a hostile body never reaches memory in full. */
export async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
