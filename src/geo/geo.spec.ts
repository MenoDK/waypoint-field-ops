import { bearingDeg, haversineKm, isValidCoordinate, pathLengthKm, progressPercent } from './geo';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lat: 38.5, lng: -98 }, { lat: 38.5, lng: -98 })).toBe(0);
  });

  it('matches a known distance: one degree of latitude is about 111.2 km', () => {
    expect(haversineKm({ lat: 0, lng: 10 }, { lat: 1, lng: 10 })).toBeCloseTo(111.2, 1);
  });

  it('matches a long known distance within a fraction of a percent (Paris to New York, ~5837 km)', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 40.7128, lng: -74.006 });
    expect(Math.abs(d - 5837) / 5837).toBeLessThan(0.005);
  });

  it('is symmetric', () => {
    const a = { lat: 38.5, lng: -98 };
    const b = { lat: 39.1, lng: -97.2 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('does not return NaN for antipodal points', () => {
    const d = haversineKm({ lat: 10, lng: 20 }, { lat: -10, lng: -160 });
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeCloseTo(Math.PI * 6371.0088, 0);
  });
});

describe('isValidCoordinate', () => {
  it.each([
    [38.5, -98, true],
    [90, 180, true],
    [-90, -180, true],
    [90.0001, 0, false],
    [0, 180.0001, false],
    [Number.NaN, 1, false],
    [1, Number.POSITIVE_INFINITY, false],
  ])('(%p, %p) -> %p', (lat, lng, expected) => {
    expect(isValidCoordinate(lat, lng)).toBe(expected);
  });

  it('refuses Null Island: (0, 0) is what a receiver reports when it has no fix', () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(0, 0.0001)).toBe(true);
  });

  it('refuses numbers that arrived as strings', () => {
    expect(isValidCoordinate('38.5', -98)).toBe(false);
    expect(isValidCoordinate(38.5, null)).toBe(false);
  });
});

describe('bearingDeg', () => {
  it('points north, east, south and west', () => {
    const o = { lat: 10, lng: 10 };
    expect(bearingDeg(o, { lat: 11, lng: 10 })).toBeCloseTo(0, 3);
    expect(bearingDeg(o, { lat: 10, lng: 11 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 9, lng: 10 })).toBeCloseTo(180, 3);
    expect(bearingDeg(o, { lat: 10, lng: 9 })).toBeCloseTo(270, 0);
  });
});

describe('pathLengthKm', () => {
  it('sums the legs', () => {
    const a = { lat: 0, lng: 10 };
    const b = { lat: 1, lng: 10 };
    const c = { lat: 2, lng: 10 };
    expect(pathLengthKm([a, b, c])).toBeCloseTo(haversineKm(a, b) + haversineKm(b, c), 9);
  });

  it('is zero for fewer than two points', () => {
    expect(pathLengthKm([])).toBe(0);
    expect(pathLengthKm([{ lat: 1, lng: 1 }])).toBe(0);
  });
});

describe('progressPercent', () => {
  it('is 0 at the start, 100 at the destination and clamped in between', () => {
    expect(progressPercent(100, 100)).toBe(0);
    expect(progressPercent(100, 25)).toBe(75);
    expect(progressPercent(100, 0)).toBe(100);
  });

  it('never leaves 0..100, even when the vehicle is further away than where it started', () => {
    expect(progressPercent(100, 160)).toBe(0);
    expect(progressPercent(100, -5)).toBe(100);
  });

  it('is 0 for a zero-length trip instead of dividing by zero', () => {
    expect(progressPercent(0, 0)).toBe(0);
  });
});
