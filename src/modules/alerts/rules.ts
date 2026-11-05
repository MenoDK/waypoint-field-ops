/**
 * Which alerts should be open right now? A pure function of what the system knows about a driver and the clock (ADR 0004).
 *
 * The rules are evaluated on a schedule by the worker, NOT when a position arrives. That is the whole point: "no signal"
 * is the absence of a position, and code that only runs when a position arrives can never see it.
 */

export type AlertKind = 'no_signal' | 'long_stop' | 'arriving_soon';

export interface DriverState {
  tripStatus: 'ACCEPTED' | 'IN_TRANSIT';
  tripStartedAt: Date | null;
  /** The newest capture we hold, or null if no position has ever arrived. */
  capturedAt: Date | null;
  speedKmh: number | null;
  /** The newest capture that showed real movement. */
  lastMovedAt: Date | null;
  /** Straight-line ETA to the destination, in minutes, when it can be computed. */
  etaMinutes: number | null;
  arrived: boolean;
}

export interface Thresholds {
  noSignalMinutes: number;
  longStopMinutes: number;
  arrivingMinutes: number;
  /** At or below this the vehicle is considered stationary. */
  stoppedKmh: number;
}

export type Desired = Partial<Record<AlertKind, Record<string, unknown>>>;

const minutesBetween = (later: Date, earlier: Date): number => (later.getTime() - earlier.getTime()) / 60_000;

export function desiredAlerts(state: DriverState, now: Date, limits: Thresholds): Desired {
  // A trip that has not started cannot be late, silent or stopped: the driver has only said yes.
  if (state.tripStatus !== 'IN_TRANSIT') return {};

  const lastSeen = state.capturedAt ?? state.tripStartedAt;
  const silentFor = lastSeen ? minutesBetween(now, lastSeen) : 0;
  if (silentFor > limits.noSignalMinutes) {
    // While silent nothing else can be claimed: "stopped" and "arriving" are statements about a position we do not have.
    return {
      no_signal: { silent_minutes: Math.round(silentFor), never_reported: state.capturedAt === null },
    };
  }

  const desired: Desired = {};

  if (state.speedKmh !== null && state.speedKmh <= limits.stoppedKmh) {
    const since = state.lastMovedAt ?? state.tripStartedAt;
    const stoppedFor = since ? minutesBetween(now, since) : 0;
    if (stoppedFor > limits.longStopMinutes) desired.long_stop = { stopped_minutes: Math.round(stoppedFor) };
  }

  if (!state.arrived && state.etaMinutes !== null && state.etaMinutes <= limits.arrivingMinutes) {
    desired.arriving_soon = { eta_minutes: state.etaMinutes };
  }
  return desired;
}
