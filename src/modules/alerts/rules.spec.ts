import { desiredAlerts, type DriverState, type Thresholds } from './rules';

const limits: Thresholds = { noSignalMinutes: 15, longStopMinutes: 30, arrivingMinutes: 30, stoppedKmh: 2 };
const NOW = new Date('2026-03-01T12:00:00Z');
const ago = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const driver = (over: Partial<DriverState> = {}): DriverState => ({
  tripStatus: 'IN_TRANSIT',
  tripStartedAt: ago(120),
  capturedAt: ago(1),
  speedKmh: 80,
  lastMovedAt: ago(1),
  etaMinutes: 90,
  arrived: false,
  ...over,
});

describe('no_signal', () => {
  it('opens when the newest position is older than the limit -- the case code run on arrival can never see', () => {
    expect(desiredAlerts(driver({ capturedAt: ago(16) }), NOW, limits)).toEqual({
      no_signal: { silent_minutes: 16, never_reported: false },
    });
  });

  it('does not open at exactly the limit, and does open one minute after', () => {
    expect(desiredAlerts(driver({ capturedAt: ago(15) }), NOW, limits)).toEqual({});
    expect(Object.keys(desiredAlerts(driver({ capturedAt: ago(16) }), NOW, limits))).toEqual(['no_signal']);
  });

  it('counts from the start of the trip when no position ever arrived, and says so', () => {
    const state = driver({ capturedAt: null, speedKmh: null, lastMovedAt: null, tripStartedAt: ago(20) });
    expect(desiredAlerts(state, NOW, limits)).toEqual({
      no_signal: { silent_minutes: 20, never_reported: true },
    });
  });

  it('gives a brand-new trip a grace period before it counts as silent', () => {
    const state = driver({ capturedAt: null, speedKmh: null, lastMovedAt: null, tripStartedAt: ago(5) });
    expect(desiredAlerts(state, NOW, limits)).toEqual({});
  });

  it('suppresses the other alerts while silent: they would be claims about a position we do not have', () => {
    const state = driver({ capturedAt: ago(40), speedKmh: 0, lastMovedAt: ago(90), etaMinutes: 5 });
    expect(Object.keys(desiredAlerts(state, NOW, limits))).toEqual(['no_signal']);
  });
});

describe('long_stop', () => {
  it('opens when the vehicle has not moved for longer than the limit', () => {
    const state = driver({ speedKmh: 0, lastMovedAt: ago(45) });
    expect(desiredAlerts(state, NOW, limits)).toEqual({ long_stop: { stopped_minutes: 45 } });
  });

  it('does not open for a short stop', () => {
    expect(desiredAlerts(driver({ speedKmh: 0, lastMovedAt: ago(10) }), NOW, limits)).toEqual({});
  });

  it('does not open while the latest reading shows movement, however long ago it last stopped', () => {
    expect(desiredAlerts(driver({ speedKmh: 60, lastMovedAt: ago(1) }), NOW, limits)).toEqual({});
  });

  it('counts from the start of the trip when the vehicle never moved', () => {
    const state = driver({ speedKmh: 0, lastMovedAt: null, tripStartedAt: ago(50) });
    expect(desiredAlerts(state, NOW, limits)).toEqual({ long_stop: { stopped_minutes: 50 } });
  });

  it('needs a speed reading: an unknown speed is not "stopped"', () => {
    expect(desiredAlerts(driver({ speedKmh: null, lastMovedAt: ago(90) }), NOW, limits)).toEqual({});
  });
});

describe('arriving_soon', () => {
  it('opens when the ETA is within the limit', () => {
    expect(desiredAlerts(driver({ etaMinutes: 20 }), NOW, limits)).toEqual({
      arriving_soon: { eta_minutes: 20 },
    });
  });

  it('includes the boundary', () => {
    expect(Object.keys(desiredAlerts(driver({ etaMinutes: 30 }), NOW, limits))).toEqual(['arriving_soon']);
    expect(desiredAlerts(driver({ etaMinutes: 31 }), NOW, limits)).toEqual({});
  });

  it('is not claimed once the vehicle has arrived', () => {
    expect(desiredAlerts(driver({ etaMinutes: 0, arrived: true }), NOW, limits)).toEqual({});
  });

  it('needs an ETA', () => {
    expect(desiredAlerts(driver({ etaMinutes: null }), NOW, limits)).toEqual({});
  });
});

describe('trips that are not moving', () => {
  it('raises nothing for an accepted trip: the driver has only said yes', () => {
    const state = driver({ tripStatus: 'ACCEPTED', tripStartedAt: null, capturedAt: ago(300), speedKmh: 0 });
    expect(desiredAlerts(state, NOW, limits)).toEqual({});
  });
});

describe('re-evaluation', () => {
  it('is idempotent: the same state gives the same answer, so the evaluator can run every 30 seconds', () => {
    const state = driver({ capturedAt: ago(40) });
    expect(desiredAlerts(state, NOW, limits)).toEqual(desiredAlerts(state, NOW, limits));
  });
});
