import { haversineKm, type LatLng } from '../geo/geo';
import { geometryTrustworthy, MAX_RESPONSE_BYTES, readLimited, roadDistancePlausible } from './guards';

export interface RoadRoute {
  distanceKm: number;
  durationMinutes: number;
  geometry: LatLng[];
}

/**
 * `unavailable` -- no usable answer (network, timeout, HTTP error, oversize body, malformed JSON);
 * `untrusted`   -- an answer that does not match the question (geometry elsewhere, distance that cannot be a road);
 * `no_route`    -- the router answered properly: there is no road between these points.
 * The first two count against the circuit breaker, the third does not: the service is fine, the question has no answer.
 */
export type RouteResult =
  { ok: true; route: RoadRoute } | { ok: false; kind: 'unavailable' | 'untrusted' | 'no_route' };

interface OsrmBody {
  code?: unknown;
  routes?: { distance?: unknown; duration?: unknown; geometry?: { coordinates?: unknown } }[];
}

/** A client for the OSRM route API (`/route/v1/driving/{lng,lat;lng,lat}`). It never throws: every failure is a value. */
export class OsrmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
    const url = `${this.baseUrl.replace(/\/+$/, '')}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    let text: string | null;
    try {
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, kind: 'unavailable' };
      }
      text = await readLimited(response, MAX_RESPONSE_BYTES);
    } catch {
      return { ok: false, kind: 'unavailable' };
    }
    if (text === null) return { ok: false, kind: 'untrusted' };

    let body: OsrmBody;
    try {
      body = JSON.parse(text) as OsrmBody;
    } catch {
      return { ok: false, kind: 'unavailable' };
    }
    if (body.code === 'NoRoute') return { ok: false, kind: 'no_route' };
    const first = body.routes?.[0];
    if (body.code !== 'Ok' || !first) return { ok: false, kind: 'unavailable' };

    const geometry = geometryTrustworthy(first.geometry?.coordinates, [from, to]);
    const distanceKm = typeof first.distance === 'number' ? first.distance / 1000 : Number.NaN;
    const durationMin = typeof first.duration === 'number' ? first.duration / 60 : Number.NaN;
    if (
      !geometry ||
      !roadDistancePlausible(distanceKm, haversineKm(from, to)) ||
      !Number.isFinite(durationMin) ||
      durationMin < 0
    ) {
      return { ok: false, kind: 'untrusted' };
    }
    return { ok: true, route: { distanceKm, durationMinutes: durationMin, geometry } };
  }
}
