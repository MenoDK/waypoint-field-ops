import { z } from 'zod';
import { isValidCoordinate } from '../../geo/geo';

/**
 * What a phone may send, and what the server believes of it (ADR 0002).
 *
 * Two layers on purpose. The schema only checks SHAPE: a request that is not a list of objects with numbers in them is a
 * client bug and fails as a whole. `screenPing` checks MEANING per ping: one reading with no GPS fix (0, 0) or a wrong clock
 * must not throw away the 299 good ones that rode in the same batch after an hour in a tunnel.
 */
export const pingSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    captured_at: z.iso.datetime({ offset: true }),
    accuracy_m: z.number().min(0).max(100_000).optional(),
    speed_kmh: z.number().min(0).max(400).optional(),
    heading_deg: z.number().min(0).lt(360).optional(),
    source: z.enum(['checkin', 'polling', 'batch']).default('polling'),
  })
  .strict();

export type PingInput = z.infer<typeof pingSchema>;

export const batchSchema = (maxBatch: number) =>
  z.object({ pings: z.array(pingSchema).min(1).max(maxBatch) }).strict();

export type RejectReason = 'bad_coordinate' | 'future' | 'too_old';

export interface ScreenOptions {
  now: Date;
  retentionDays: number;
  maxFutureSkewSeconds: number;
}

export type Screened = { ok: true; capturedAt: Date } | { ok: false; reason: RejectReason };

export function screenPing(ping: PingInput, options: ScreenOptions): Screened {
  if (!isValidCoordinate(ping.lat, ping.lng)) return { ok: false, reason: 'bad_coordinate' };
  const capturedAt = new Date(ping.captured_at);
  const ageMs = options.now.getTime() - capturedAt.getTime();
  // A timestamp ahead of the server by more than the skew allowance is a phone with a wrong clock. Believing it would put
  // a vehicle "in the future", where it would also win every "newest position" comparison until real time caught up.
  if (ageMs < -options.maxFutureSkewSeconds * 1000) return { ok: false, reason: 'future' };
  // Older than retention: the partition for that day is gone (or about to be), and keeping it would defeat retention.
  if (ageMs > options.retentionDays * 86_400_000) return { ok: false, reason: 'too_old' };
  return { ok: true, capturedAt };
}
