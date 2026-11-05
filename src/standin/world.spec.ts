import { haversineKm } from '../geo/geo';
import { nearestVertex, pointAlong, ROADS, shortestPath, TOWNS, VERTICES } from './world';

describe('the made-up region', () => {
  it('has twelve towns with distinct names and ids', () => {
    expect(TOWNS).toHaveLength(12);
    expect(new Set(TOWNS.map((t) => t.name)).size).toBe(12);
    expect(new Set(TOWNS.map((t) => t.id)).size).toBe(12);
  });

  it('is the same world every time (the roads are a function of their names)', () => {
    expect(VERTICES.get('t00-t10#3')).toEqual(VERTICES.get('t00-t10#3'));
    expect(ROADS.length).toBeGreaterThan(100);
  });

  it('connects every town to every other town', () => {
    for (const a of TOWNS) for (const b of TOWNS) expect(shortestPath(a.id, b.id)).not.toBeNull();
  });

  it('never has a road shorter than the straight line, and detours where a link is missing', () => {
    const direct = shortestPath('t00', 't10');
    expect(direct).not.toBeNull();
    const straight = haversineKm(TOWNS[0] as never, TOWNS[1] as never);
    expect((direct as { km: number }).km).toBeGreaterThanOrEqual(straight * 0.999);

    // t10-t11 is missing: going north from t10 to t11 must take the long way round
    const detour = shortestPath('t10', 't11') as { km: number };
    const crow = haversineKm(TOWNS[1] as never, TOWNS[5] as never);
    expect(detour.km).toBeGreaterThan(crow * 2);
  });

  it('finds a path from a vertex to itself of zero length', () => {
    expect(shortestPath('t00', 't00')).toEqual({ vertices: [VERTICES.get('t00')], km: 0 });
  });

  it('returns null for an unknown vertex', () => {
    expect(shortestPath('t00', 'nowhere')).toBeNull();
  });

  it('snaps a point to the nearest vertex', () => {
    const town = TOWNS[5] as { id: string; lat: number; lng: number };
    expect(nearestVertex({ lat: town.lat + 0.0001, lng: town.lng - 0.0001 }).id).toBe(town.id);
  });
});

describe('pointAlong', () => {
  const path = [
    { lat: 38.4, lng: -98 },
    { lat: 38.4, lng: -97.9 },
    { lat: 38.5, lng: -97.9 },
  ];

  it('starts at the start and ends at the end, clamping past either', () => {
    expect(pointAlong(path, 0).point).toEqual(path[0]);
    expect(pointAlong(path, -5).point).toEqual(path[0]);
    expect(pointAlong(path, 1e6).point).toEqual(path[2]);
  });

  it('is on the first leg heading east, then on the second heading north', () => {
    const firstLeg = haversineKm(path[0] as never, path[1] as never);
    expect(pointAlong(path, firstLeg / 2).heading).toBeCloseTo(90, 0);
    expect(pointAlong(path, firstLeg + 1).heading).toBeCloseTo(0, 0);
  });

  it('is the right distance from the start', () => {
    const km = 3;
    const { point } = pointAlong(path, km);
    expect(haversineKm(path[0] as never, point)).toBeCloseTo(km, 1);
  });
});
