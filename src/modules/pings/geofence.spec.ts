import { hasArrived } from './geofence';

const at = (...distances: number[]) => distances.map((distanceM) => ({ distanceM }));

describe('hasArrived', () => {
  it('needs the last N fixes inside the radius', () => {
    expect(hasArrived(at(40, 60), 150, 2)).toBe(true);
  });

  it('is not an arrival after a single good fix when two are required (GPS jitter)', () => {
    expect(hasArrived(at(40), 150, 2)).toBe(false);
  });

  it('is not an arrival when the newest fix has already left the circle', () => {
    expect(hasArrived(at(400, 40, 30), 150, 2)).toBe(false);
  });

  it('is not an arrival when the second newest fix is outside, however close the newest one is', () => {
    expect(hasArrived(at(40, 400), 150, 2)).toBe(false);
  });

  it('counts the boundary as inside', () => {
    expect(hasArrived(at(150, 150), 150, 2)).toBe(true);
    expect(hasArrived(at(150, 151), 150, 2)).toBe(false);
  });

  it('only looks at the most recent N: an old excursion does not matter', () => {
    expect(hasArrived(at(10, 20, 5000, 8000), 150, 2)).toBe(true);
  });

  it('with one confirmation required, one good fix is enough', () => {
    expect(hasArrived(at(40), 150, 1)).toBe(true);
  });

  it('never arrives with no fixes', () => {
    expect(hasArrived([], 150, 1)).toBe(false);
  });
});
