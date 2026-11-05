import {
  BOX_MARGIN_DEG,
  geometryTrustworthy,
  MAX_VERTICES,
  readLimited,
  roadDistancePlausible,
  routerUrlAcceptable,
} from './guards';

const A = { lat: 38.5, lng: -98 };
const B = { lat: 38.7, lng: -97.8 };

describe('routerUrlAcceptable', () => {
  it.each([
    'https://router.example.org',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://10.1.2.3:5000',
    'http://192.168.1.20',
    'http://172.20.0.5',
    'http://router:5000', // a bare service name on a Compose network
    'http://osrm.internal',
    'http://[::1]:5000',
  ])('accepts %s', (url) => {
    expect(routerUrlAcceptable(url)).toEqual({ ok: true });
  });

  it.each(['http://router.project-osrm.org', 'http://8.8.8.8', 'http://172.32.0.1', 'http://example.com'])(
    'refuses plain text to a public host: %s',
    (url) => {
      expect(routerUrlAcceptable(url)).toMatchObject({ ok: false });
    },
  );

  it.each(['not a url', 'ftp://router', 'file:///etc/passwd'])('refuses %s', (url) => {
    expect(routerUrlAcceptable(url)).toMatchObject({ ok: false });
  });
});

describe('geometryTrustworthy', () => {
  const line = [
    [-98, 38.5],
    [-97.9, 38.6],
    [-97.8, 38.7],
  ];

  it('returns the geometry as lat/lng when it matches the question', () => {
    expect(geometryTrustworthy(line, [A, B])).toEqual([
      { lat: 38.5, lng: -98 },
      { lat: 38.6, lng: -97.9 },
      { lat: 38.7, lng: -97.8 },
    ]);
  });

  it('refuses a geometry with a single point outside the region asked about', () => {
    const wandering = [...line, [-97.8 + BOX_MARGIN_DEG + 0.5, 38.7]];
    expect(geometryTrustworthy(wandering, [A, B])).toBeNull();
  });

  it('accepts a detour inside the margin', () => {
    expect(
      geometryTrustworthy(
        [
          [-98, 38.5],
          [-96.5, 38.4],
          [-97.8, 38.7],
        ],
        [A, B],
      ),
    ).not.toBeNull();
  });

  it.each([
    ['not an array', 'nope'],
    ['a single point', [[-98, 38.5]]],
    ['a pair that is not a pair', [[-98, 38.5], 7]],
    [
      'a coordinate that is not a number',
      [
        [-98, 38.5],
        ['x', 38.6],
      ],
    ],
    [
      'a NaN coordinate',
      [
        [-98, 38.5],
        [Number.NaN, 38.6],
      ],
    ],
    [
      'a coordinate out of range',
      [
        [-98, 38.5],
        [-98, 95],
      ],
    ],
    ['null', null],
  ])('refuses %s', (_name, bad) => {
    expect(geometryTrustworthy(bad, [A, B])).toBeNull();
  });

  it('refuses an absurd number of vertices', () => {
    const huge = Array.from({ length: MAX_VERTICES + 1 }, () => [-98, 38.5]);
    expect(geometryTrustworthy(huge, [A, B])).toBeNull();
  });

  it('refuses when nothing was asked', () => {
    expect(geometryTrustworthy(line, [])).toBeNull();
  });
});

describe('roadDistancePlausible', () => {
  it('accepts a road a little longer than the straight line', () => {
    expect(roadDistancePlausible(26, 25)).toBe(true);
  });

  it('refuses a road shorter than the straight line (it cannot be)', () => {
    expect(roadDistancePlausible(20, 25)).toBe(false);
  });

  it('accepts rounding noise just below the line', () => {
    expect(roadDistancePlausible(24.6, 25)).toBe(true);
  });

  it('refuses an absurd detour, and tolerates a large factor on very short trips', () => {
    expect(roadDistancePlausible(400, 25)).toBe(false);
    expect(roadDistancePlausible(1.5, 0.2)).toBe(true);
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p', (value) => {
    expect(roadDistancePlausible(value, 25)).toBe(false);
  });

  it('accepts a road of length zero only when the two points really are the same place', () => {
    expect(roadDistancePlausible(0, 0)).toBe(true); // already at the destination
    expect(roadDistancePlausible(0, 0.04)).toBe(true);
    expect(roadDistancePlausible(0, 0.5)).toBe(false); // half a kilometre apart is not "no road"
  });
});

describe('readLimited', () => {
  it('reads a body under the limit', async () => {
    expect(await readLimited(new Response('hello'), 100)).toBe('hello');
  });

  it('refuses a body over the limit without reading all of it', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 10_000) controller.close();
      },
    });
    expect(await readLimited(new Response(body), 4096)).toBeNull();
    expect(pulled).toBeLessThan(20); // it stopped long before the stream ended
  });

  it('refuses early when the declared length is already over the limit', async () => {
    const response = new Response('x', { headers: { 'content-length': '999999' } });
    expect(await readLimited(response, 100)).toBeNull();
  });
});
