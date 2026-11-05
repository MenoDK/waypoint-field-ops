/**
 * The life of a trip. The table below is the whole policy: who may move a trip from which state to which.
 * The service applies it with a compare-and-set (`UPDATE ... WHERE status = <from>`), so the table is checked by the
 * database at the moment of the write and two racing requests cannot both succeed.
 */

export type TripStatus = 'PLANNED' | 'ACCEPTED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
export type TripAction = 'accept' | 'start' | 'complete' | 'cancel';
export type Actor = 'driver' | 'dispatcher';

interface Transition {
  from: TripStatus;
  to: TripStatus;
  actor: Actor;
}

const TRANSITIONS: Record<TripAction, Transition[]> = {
  accept: [{ from: 'PLANNED', to: 'ACCEPTED', actor: 'driver' }],
  start: [{ from: 'ACCEPTED', to: 'IN_TRANSIT', actor: 'driver' }],
  complete: [{ from: 'IN_TRANSIT', to: 'COMPLETED', actor: 'driver' }],
  cancel: [
    { from: 'PLANNED', to: 'CANCELLED', actor: 'dispatcher' },
    { from: 'ACCEPTED', to: 'CANCELLED', actor: 'dispatcher' },
  ],
};

export type TransitionCheck =
  | { ok: true; from: TripStatus; to: TripStatus }
  | { ok: false; reason: 'wrong_actor' | 'wrong_state'; expectedFrom: TripStatus[] };

export function check(action: TripAction, actor: Actor, current: TripStatus): TransitionCheck {
  const options = TRANSITIONS[action];
  const forActor = options.filter((t) => t.actor === actor);
  if (forActor.length === 0)
    return { ok: false, reason: 'wrong_actor', expectedFrom: options.map((t) => t.from) };
  const match = forActor.find((t) => t.from === current);
  if (!match) return { ok: false, reason: 'wrong_state', expectedFrom: forActor.map((t) => t.from) };
  return { ok: true, from: match.from, to: match.to };
}

/** The states an action can start from, for the compare-and-set. */
export function sourceStates(action: TripAction): TripStatus[] {
  return TRANSITIONS[action].map((t) => t.from);
}

export type OdometerCheck = { ok: true } | { ok: false; reason: 'not_after_start' };

/** The odometer only runs forward: the end reading must be strictly greater than the start reading. */
export function checkOdometer(kmStart: number | null, kmEnd: number): OdometerCheck {
  if (kmStart !== null && kmEnd <= kmStart) return { ok: false, reason: 'not_after_start' };
  return { ok: true };
}
