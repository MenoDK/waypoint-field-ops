import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth';
import { Clock } from '../../common/clock';
import { conflict } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService, type Tx } from '../../database/database.service';
import { EVENTS, publish } from '../../realtime/events';
import { MetricsService } from '../observability/metrics.service';
import { hasArrived } from './geofence';
import { type PingInput, type RejectReason, screenPing } from './screen';

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: { index: number; reason: RejectReason }[];
  /** True when this batch moved the driver's live position (a batch of old readings does not). */
  position_updated: boolean;
}

interface Accepted {
  index: number;
  ping: PingInput;
  capturedAt: Date;
}

@Injectable()
export class PingsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  /**
   * Stores a batch of readings from one driver's phone (ADR 0002, ADR 0003).
   *
   * - Meaning is checked per reading; the bad ones are listed in `rejected` and the good ones are kept.
   * - Writing is one statement with `ON CONFLICT DO NOTHING` on (driver, capture time): a retried or replayed batch cannot
   *   create a duplicate, even when two copies arrive at the same instant.
   * - Each reading is attributed to the trip that covered its CAPTURE time, not to whatever trip is running when the batch
   *   finally arrives -- so a batch uploaded after a trip ended still belongs to that trip.
   * - The live position moves only forward in capture time. A late batch cannot drag the pin backwards.
   */
  async ingest(user: AuthUser, pings: readonly PingInput[]): Promise<IngestResult> {
    const now = this.clock.now();
    const rejected: IngestResult['rejected'] = [];
    const accepted: Accepted[] = [];
    pings.forEach((ping, index) => {
      const verdict = screenPing(ping, {
        now,
        retentionDays: this.env.PING_RETENTION_DAYS,
        maxFutureSkewSeconds: this.env.PING_MAX_FUTURE_SKEW_SECONDS,
      });
      if (verdict.ok) accepted.push({ index, ping, capturedAt: verdict.capturedAt });
      else rejected.push({ index, reason: verdict.reason });
    });
    // Oldest first, always. Two batches that overlap (a retry that carries a few more readings) then take their row locks in
    // the same order, so they queue behind each other instead of deadlocking.
    accepted.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    if (accepted.length === 0) {
      const none: IngestResult = { accepted: 0, duplicates: 0, rejected, position_updated: false };
      this.count(none);
      return none;
    }

    const result = await this.db.tx(async (tx): Promise<IngestResult> => {
      const vehicle = await tx.query<{ vehicle_id: string | null }>(
        'SELECT vehicle_id FROM users WHERE id = $1 AND fleet_id = $2 AND role = $3',
        [user.userId, user.fleetId, 'driver'],
      );
      const vehicleId = vehicle.rows[0]?.vehicle_id;
      if (!vehicleId)
        throw conflict(
          'NO_VEHICLE',
          'This driver has no vehicle assigned, so there is nothing to attribute positions to',
        );

      const stored = await tx.query<{ captured_at: Date }>(
        `INSERT INTO pings (driver_id, captured_at, fleet_id, vehicle_id, trip_id, geom, accuracy_m, speed_kmh, heading_deg, source)
         SELECT $1::uuid, i.captured_at, $2::uuid, $3::uuid,
                (SELECT tr.id FROM trips tr
                  WHERE tr.driver_id = $1::uuid AND tr.started_at IS NOT NULL AND tr.started_at <= i.captured_at
                    AND (tr.completed_at IS NULL OR i.captured_at <= tr.completed_at)
                  ORDER BY tr.started_at DESC LIMIT 1),
                ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326)::geography, i.accuracy_m, i.speed_kmh, i.heading_deg, i.source
           FROM unnest($4::timestamptz[], $5::float8[], $6::float8[], $7::real[], $8::real[], $9::real[], $10::text[])
                AS i(captured_at, lat, lng, accuracy_m, speed_kmh, heading_deg, source)
         ON CONFLICT (driver_id, captured_at) DO NOTHING
         RETURNING captured_at`,
        [
          user.userId,
          user.fleetId,
          vehicleId,
          accepted.map((a) => a.capturedAt.toISOString()),
          accepted.map((a) => a.ping.lat),
          accepted.map((a) => a.ping.lng),
          accepted.map((a) => a.ping.accuracy_m ?? null),
          accepted.map((a) => a.ping.speed_kmh ?? null),
          accepted.map((a) => a.ping.heading_deg ?? null),
          accepted.map((a) => a.ping.source),
        ],
      );
      const duplicates = accepted.length - stored.rowCount!;
      if (stored.rowCount === 0) return { accepted: 0, duplicates, rejected, position_updated: false };

      const fresh = new Set(stored.rows.map((r) => r.captured_at.getTime()));
      const kept = accepted.filter((a) => fresh.has(a.capturedAt.getTime()));
      const newest = kept.reduce((best, a) => (a.capturedAt > best.capturedAt ? a : best));
      const moved = kept
        .filter((a) => (a.ping.speed_kmh ?? 0) > this.env.MOVING_KMH && this.accurate(a.ping))
        .reduce<Date | null>((best, a) => (best === null || a.capturedAt > best ? a.capturedAt : best), null);

      const positionUpdated = await this.moveLivePosition(tx, user, vehicleId, newest, moved);
      await this.detectArrival(tx, user);
      return { accepted: stored.rowCount!, duplicates, rejected, position_updated: positionUpdated };
    });
    this.count(result); // counted after the commit: a rolled-back batch is not "received"
    return result;
  }

  private count(result: IngestResult): void {
    this.metrics.pingsReceived.inc({ outcome: 'accepted' }, result.accepted);
    this.metrics.pingsReceived.inc({ outcome: 'duplicate' }, result.duplicates);
    this.metrics.pingsReceived.inc({ outcome: 'rejected' }, result.rejected.length);
  }

  private accurate(ping: PingInput): boolean {
    return ping.accuracy_m === undefined || ping.accuracy_m <= this.env.ACCURACY_LIMIT_M;
  }

  /** Upserts the driver's live position -- only if this capture is NEWER than the one held -- and announces it. */
  private async moveLivePosition(
    tx: Tx,
    user: AuthUser,
    vehicleId: string,
    newest: Accepted,
    movedAt: Date | null,
  ): Promise<boolean> {
    const { ping, capturedAt } = newest;
    const upsert = await tx.query<{ trip_id: string | null }>(
      `INSERT INTO vehicle_positions
         (driver_id, fleet_id, vehicle_id, trip_id, geom, accuracy_m, speed_kmh, heading_deg, captured_at, last_moved_at)
       SELECT $1::uuid, $2::uuid, $3::uuid,
              (SELECT p.trip_id FROM pings p WHERE p.driver_id = $1::uuid AND p.captured_at = $4::timestamptz),
              ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography, $7::real, $8::real, $9::real, $4::timestamptz, $10::timestamptz
       ON CONFLICT (driver_id) DO UPDATE SET
         vehicle_id = EXCLUDED.vehicle_id, trip_id = EXCLUDED.trip_id, geom = EXCLUDED.geom,
         accuracy_m = EXCLUDED.accuracy_m, speed_kmh = EXCLUDED.speed_kmh, heading_deg = EXCLUDED.heading_deg,
         captured_at = EXCLUDED.captured_at, updated_at = now(),
         last_moved_at = GREATEST(vehicle_positions.last_moved_at, EXCLUDED.last_moved_at)
       WHERE EXCLUDED.captured_at > vehicle_positions.captured_at
       RETURNING trip_id`,
      [
        user.userId,
        user.fleetId,
        vehicleId,
        capturedAt.toISOString(),
        ping.lat,
        ping.lng,
        ping.accuracy_m ?? null,
        ping.speed_kmh ?? null,
        ping.heading_deg ?? null,
        movedAt?.toISOString() ?? null,
      ],
    );

    // Even when the live position did not move (a late batch), the "last time it was moving" may have advanced.
    if (upsert.rowCount === 0 && movedAt) {
      await tx.query(
        'UPDATE vehicle_positions SET last_moved_at = GREATEST(last_moved_at, $2) WHERE driver_id = $1',
        [user.userId, movedAt.toISOString()],
      );
    }
    if (upsert.rowCount === 0) return false;

    await publish(tx, {
      event: EVENTS.POSITION,
      fleetId: user.fleetId,
      driverId: user.userId,
      payload: {
        driver_id: user.userId,
        vehicle_id: vehicleId,
        trip_id: upsert.rows[0]?.trip_id ?? null,
        lat: ping.lat,
        lng: ping.lng,
        speed_kmh: ping.speed_kmh ?? null,
        heading_deg: ping.heading_deg ?? null,
        captured_at: capturedAt.toISOString(),
      },
    });
    return true;
  }

  /**
   * Arrival: the last N ACCURATE fixes of the running trip are all inside the destination's radius (ADR 0004). The write is
   * `WHERE arrived_at IS NULL`, so however many requests see the same condition at once, exactly one wins and only that one
   * announces it.
   */
  private async detectArrival(tx: Tx, user: AuthUser): Promise<void> {
    const trip = await tx.query<{ id: string; radius_m: number }>(
      `SELECT tr.id, pl.radius_m FROM trips tr JOIN places pl ON pl.id = tr.destination_id AND pl.fleet_id = tr.fleet_id
        WHERE tr.driver_id = $1 AND tr.status = 'IN_TRANSIT' AND tr.arrived_at IS NULL`,
      [user.userId],
    );
    const running = trip.rows[0];
    if (!running) return;

    const fixes = await tx.query<{ distance_m: number; captured_at: Date }>(
      `SELECT ST_Distance(p.geom, pl.geom) AS distance_m, p.captured_at
         FROM pings p
         JOIN trips tr ON tr.id = p.trip_id
         JOIN places pl ON pl.id = tr.destination_id
        WHERE p.trip_id = $1 AND p.driver_id = $2 AND (p.accuracy_m IS NULL OR p.accuracy_m <= $3)
        ORDER BY p.captured_at DESC LIMIT $4`,
      [running.id, user.userId, this.env.ACCURACY_LIMIT_M, this.env.ARRIVAL_CONFIRMATIONS],
    );
    const newestFix = fixes.rows[0];
    if (!newestFix) return;
    if (
      !hasArrived(
        fixes.rows.map((r) => ({ distanceM: Number(r.distance_m) })),
        running.radius_m,
        this.env.ARRIVAL_CONFIRMATIONS,
      )
    ) {
      return;
    }

    const won = await tx.query<{ id: string }>(
      `UPDATE trips SET arrived_at = $2, updated_at = now()
        WHERE id = $1 AND arrived_at IS NULL AND status = 'IN_TRANSIT' RETURNING id`,
      [running.id, newestFix.captured_at.toISOString()],
    );
    if (won.rowCount === 0) return;
    await publish(tx, {
      event: EVENTS.TRIP_ARRIVED,
      fleetId: user.fleetId,
      driverId: user.userId,
      payload: {
        trip_id: running.id,
        driver_id: user.userId,
        arrived_at: newestFix.captured_at.toISOString(),
      },
    });
  }
}
