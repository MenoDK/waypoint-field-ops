import { estimateSpeedKmh, straightLineEta, type SpeedOptions, type SpeedSample } from './eta';

const options: SpeedOptions = { movingKmh: 5, defaultKmh: 60, accuracyLimitM: 100 };
const moving = (speedKmh: number, accuracyM: number | null = 10): SpeedSample => ({ speedKmh, accuracyM });

describe('estimateSpeedKmh', () => {
  it('uses the default, and says so, when there is not enough evidence', () => {
    expect(estimateSpeedKmh([], options)).toEqual({ kmh: 60, basis: 'default', samples: 0 });
    expect(estimateSpeedKmh([moving(80), moving(82)], options)).toMatchObject({
      basis: 'default',
      samples: 2,
    });
  });

  it('averages the moving samples', () => {
    const estimate = estimateSpeedKmh([moving(80), moving(90), moving(100)], options);
    expect(estimate).toEqual({ kmh: 90, basis: 'measured', samples: 3 });
  });

  it('ignores time spent standing still: a long wait at a light does not make a slow driver', () => {
    const samples = [moving(0), moving(0), moving(2), moving(80), moving(90), moving(100)];
    expect(estimateSpeedKmh(samples, options).kmh).toBe(90);
  });

  it('ignores a fix that is too inaccurate to trust, but keeps one with no accuracy figure', () => {
    const samples = [moving(80, 10), moving(80, 10), moving(80, null), moving(200, 500)];
    expect(estimateSpeedKmh(samples, options)).toEqual({ kmh: 80, basis: 'measured', samples: 3 });
  });

  it('ignores a sample with no speed at all', () => {
    const samples: SpeedSample[] = [{ speedKmh: null, accuracyM: 5 }, moving(70), moving(70), moving(70)];
    expect(estimateSpeedKmh(samples, options).samples).toBe(3);
  });

  it('trims the extremes once there are ten samples, so one spike does not move the estimate', () => {
    const steady = Array.from({ length: 9 }, () => moving(80));
    const withSpike = estimateSpeedKmh([...steady, moving(300)], options);
    expect(withSpike.kmh).toBe(80);
  });

  it('does not trim below ten samples (not enough data to know what is an outlier)', () => {
    const steady = Array.from({ length: 5 }, () => moving(80));
    expect(estimateSpeedKmh([...steady, moving(140)], options).kmh).toBeCloseTo(90, 5);
  });
});

describe('straightLineEta', () => {
  it('divides distance by speed and labels the method', () => {
    const eta = straightLineEta(45, { kmh: 90, basis: 'measured', samples: 12 });
    expect(eta).toEqual({ distanceKm: 45, minutes: 30, source: 'straight_line', speedBasis: 'measured' });
  });

  it('carries the speed basis, so an assumed speed is never presented as a measured one', () => {
    expect(straightLineEta(10, { kmh: 60, basis: 'default', samples: 0 }).speedBasis).toBe('default');
  });

  it('is zero minutes at the destination', () => {
    expect(straightLineEta(0, { kmh: 60, basis: 'default', samples: 0 }).minutes).toBe(0);
  });
});
