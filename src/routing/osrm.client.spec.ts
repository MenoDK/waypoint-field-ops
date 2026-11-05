import { OsrmClient } from './osrm.client';

const FROM = { lat: 38.5, lng: -98 };
const TO = { lat: 38.7, lng: -97.8 };
// ~28 km apart in a straight line
const GOOD = {
  code: 'Ok',
  routes: [
    {
      distance: 31_000,
      duration: 1_800,
      geometry: {
        coordinates: [
          [-98, 38.5],
          [-97.9, 38.6],
          [-97.8, 38.7],
        ],
      },
    },
  ],
};

const reply = (body: unknown, init: ResponseInit = {}) =>
  (async () => new Response(JSON.stringify(body), init)) as typeof fetch;
const client = (fetchFn: typeof fetch) => new OsrmClient('http://router:5000', 500, fetchFn);

describe('OsrmClient', () => {
  it('returns the route in kilometres, minutes and lat/lng', async () => {
    const result = await client(reply(GOOD)).route(FROM, TO);
    expect(result).toMatchObject({ ok: true, route: { distanceKm: 31, durationMinutes: 30 } });
    if (result.ok) expect(result.route.geometry[0]).toEqual({ lat: 38.5, lng: -98 });
  });

  it('asks for the right URL, in lng,lat order', async () => {
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify(GOOD));
    }) as unknown as typeof fetch;
    await client(spy).route(FROM, TO);
    expect(seen).toBe(
      'http://router:5000/route/v1/driving/-98.000000,38.500000;-97.800000,38.700000?overview=full&geometries=geojson',
    );
  });

  it('treats a network failure as unavailable, never as an exception', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await client(down).route(FROM, TO)).toEqual({ ok: false, kind: 'unavailable' });
  });

  it('treats a timeout as unavailable', async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
      })) as unknown as typeof fetch;
    const impatient = new OsrmClient('http://router:5000', 30, slow);
    expect(await impatient.route(FROM, TO)).toEqual({ ok: false, kind: 'unavailable' });
  });

  it('treats an HTTP error as unavailable', async () => {
    expect(await client(reply({}, { status: 503 })).route(FROM, TO)).toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });

  it('treats malformed JSON as unavailable', async () => {
    const garbage = (async () => new Response('<html>oops</html>')) as typeof fetch;
    expect(await client(garbage).route(FROM, TO)).toEqual({ ok: false, kind: 'unavailable' });
  });

  it('treats "NoRoute" as an answer, not a failure', async () => {
    expect(await client(reply({ code: 'NoRoute' })).route(FROM, TO)).toEqual({ ok: false, kind: 'no_route' });
  });

  it('treats any other code as unavailable', async () => {
    expect(await client(reply({ code: 'InvalidQuery' })).route(FROM, TO)).toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });

  it('refuses a geometry that wanders outside the region asked about', async () => {
    const wandering = {
      ...GOOD,
      routes: [
        {
          ...GOOD.routes[0],
          geometry: {
            coordinates: [
              [-98, 38.5],
              [10, 50],
              [-97.8, 38.7],
            ],
          },
        },
      ],
    };
    expect(await client(reply(wandering)).route(FROM, TO)).toEqual({ ok: false, kind: 'untrusted' });
  });

  it('refuses a distance that cannot be a road between these points', async () => {
    const absurd = { ...GOOD, routes: [{ ...GOOD.routes[0], distance: 900_000 }] };
    expect(await client(reply(absurd)).route(FROM, TO)).toEqual({ ok: false, kind: 'untrusted' });
    const impossible = { ...GOOD, routes: [{ ...GOOD.routes[0], distance: 5_000 }] };
    expect(await client(reply(impossible)).route(FROM, TO)).toEqual({ ok: false, kind: 'untrusted' });
  });

  it('refuses a response that is too large to be a route', async () => {
    const huge = (async () => new Response('x'.repeat(3 * 1024 * 1024))) as typeof fetch;
    expect(await client(huge).route(FROM, TO)).toEqual({ ok: false, kind: 'untrusted' });
  });

  it('refuses a missing or non-numeric duration', async () => {
    const noDuration = { ...GOOD, routes: [{ ...GOOD.routes[0], duration: 'soon' }] };
    expect(await client(reply(noDuration)).route(FROM, TO)).toEqual({ ok: false, kind: 'untrusted' });
  });

  it('does not follow redirects (a router has no business sending the request elsewhere)', async () => {
    let init: RequestInit | undefined;
    const spy = (async (_url: string, i: RequestInit) => {
      init = i;
      return new Response(JSON.stringify(GOOD));
    }) as unknown as typeof fetch;
    await client(spy).route(FROM, TO);
    expect(init?.redirect).toBe('error');
  });
});
