import { check, checkOdometer, sourceStates, type TripAction, type TripStatus } from './trip-state';

describe('trip transitions', () => {
  it('accept, start and complete are the driver, in order', () => {
    expect(check('accept', 'driver', 'PLANNED')).toEqual({ ok: true, from: 'PLANNED', to: 'ACCEPTED' });
    expect(check('start', 'driver', 'ACCEPTED')).toEqual({ ok: true, from: 'ACCEPTED', to: 'IN_TRANSIT' });
    expect(check('complete', 'driver', 'IN_TRANSIT')).toEqual({
      ok: true,
      from: 'IN_TRANSIT',
      to: 'COMPLETED',
    });
  });

  it('a trip cannot be started without being accepted (acceptance is a step, not a formality)', () => {
    expect(check('start', 'driver', 'PLANNED')).toMatchObject({ ok: false, reason: 'wrong_state' });
  });

  it('only the dispatcher cancels, and only before the trip has started', () => {
    expect(check('cancel', 'dispatcher', 'PLANNED')).toMatchObject({ ok: true, to: 'CANCELLED' });
    expect(check('cancel', 'dispatcher', 'ACCEPTED')).toMatchObject({ ok: true, to: 'CANCELLED' });
    expect(check('cancel', 'dispatcher', 'IN_TRANSIT')).toMatchObject({ ok: false, reason: 'wrong_state' });
    expect(check('cancel', 'driver', 'PLANNED')).toMatchObject({ ok: false, reason: 'wrong_actor' });
  });

  it('a dispatcher cannot do the driver’s steps', () => {
    for (const action of ['accept', 'start', 'complete'] as TripAction[]) {
      expect(check(action, 'dispatcher', 'PLANNED')).toMatchObject({ ok: false, reason: 'wrong_actor' });
    }
  });

  it('finished trips are final: nothing moves a COMPLETED or CANCELLED trip', () => {
    const final: TripStatus[] = ['COMPLETED', 'CANCELLED'];
    for (const state of final) {
      for (const action of ['accept', 'start', 'complete'] as TripAction[]) {
        expect(check(action, 'driver', state).ok).toBe(false);
      }
      expect(check('cancel', 'dispatcher', state).ok).toBe(false);
    }
  });

  it('exposes the source states for the compare-and-set', () => {
    expect(sourceStates('accept')).toEqual(['PLANNED']);
    expect(sourceStates('cancel').sort()).toEqual(['ACCEPTED', 'PLANNED']);
  });
});

describe('odometer', () => {
  it('must advance', () => {
    expect(checkOdometer(1000, 1001)).toEqual({ ok: true });
    expect(checkOdometer(1000, 1000)).toEqual({ ok: false, reason: 'not_after_start' });
    expect(checkOdometer(1000, 900)).toEqual({ ok: false, reason: 'not_after_start' });
  });

  it('a start of zero is a real reading (a new vehicle), not "missing"', () => {
    expect(checkOdometer(0, 0)).toEqual({ ok: false, reason: 'not_after_start' });
    expect(checkOdometer(0, 5)).toEqual({ ok: true });
  });
});
