import { z } from 'zod';
import type { Tx } from '../database/database.service';

/**
 * The real-time contract: every event name that exists, in one place (ADR 0007).
 *
 * A name is a string on both sides of a socket, and a string does not break when one side is renamed. So the producer and the
 * consumer both import this list, and a test reads the browser code and the server code and fails the build if either side
 * uses a name that is not here -- or if a name here is never emitted. The failure it prevents is a screen that listens for an
 * event nobody sends and looks fine because something else happens to refresh it.
 */
export const EVENTS = {
  POSITION: 'position',
  ALERT_OPENED: 'alert.opened',
  ALERT_CLEARED: 'alert.cleared',
  TRIP_UPDATED: 'trip.updated',
  TRIP_ARRIVED: 'trip.arrived',
  QUEUE_UPDATED: 'queue.updated',
  TICKET_CALLED: 'ticket.called',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export const ALL_EVENTS: readonly EventName[] = Object.values(EVENTS);

/** Events that also go to the one driver they concern (their own trip), besides the dispatchers of the fleet. */
export const DRIVER_EVENTS: ReadonlySet<EventName> = new Set<EventName>([EVENTS.TRIP_UPDATED]);

export const CHANNEL = 'waypoint_events';

export const busMessageSchema = z.object({
  event: z.enum(Object.values(EVENTS) as [EventName, ...EventName[]]),
  fleetId: z.uuid(),
  driverId: z.uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type BusMessage = z.infer<typeof busMessageSchema>;

/**
 * Publishes an event from INSIDE the transaction that caused it. Postgres delivers a NOTIFY only when its transaction
 * commits, so nothing is ever announced that then rolls back, and no code has to remember to "emit after commit".
 * Delivery is best effort (a listener that is down misses it); the database is the truth and a reconnecting screen reloads
 * the snapshot.
 */
export async function publish(tx: Tx, message: BusMessage): Promise<void> {
  const text = JSON.stringify(message);
  // NOTIFY carries at most 8000 bytes. Every payload here is a handful of ids and numbers; this makes a mistake loud.
  if (Buffer.byteLength(text) > 7000) throw new Error(`bus message for ${message.event} is too large`);
  await tx.query('SELECT pg_notify($1, $2)', [CHANNEL, text]);
}

export const fleetRoom = (fleetId: string): string => `fleet:${fleetId}`;
export const driverRoom = (driverId: string): string => `driver:${driverId}`;
