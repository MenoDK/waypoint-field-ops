import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../common/auth';
import { Clock } from '../../common/clock';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import type { SpeedSample } from '../../geo/eta';
import { EtaService } from '../fleet/eta.service';
import { EVENTS, publish } from '../../realtime/events';
import { type AlertKind, type Desired, desiredAlerts, type DriverState } from './rules';
import { STOPPED_KMH } from '../fleet/fleet.service';

interface Candidate {
  driver_id: string;
  fleet_id: string;
  trip_id: string;
  trip_status: 'ACCEPTED' | 'IN_TRANSIT';
  started_at: Date | null;
  arrived_at: Date | null;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  captured_at: Date | null;
  last_moved_at: Date | null;
  dest_lat: number;
  dest_lng: number;
  samples: { s: number | null; a: number | null }[];
}

export interface EvaluationSummary {
  evaluated: number;
  opened: number;
  cleared: number;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(EtaService) private readonly eta: EtaService,
  ) {}

  list(user: AuthUser, status: 'open' | 'cleared' | undefined) {
    return this.db
      .query(
        `SELECT a.id, a.driver_id, u.name AS driver_name, a.trip_id, a.kind, a.status, a.opened_at, a.cleared_at, a.detail
           FROM alerts a JOIN users u ON u.id = a.driver_id
          WHERE a.fleet_id = $1 AND ($2::text IS NULL OR a.status = $2)
          ORDER BY a.opened_at DESC LIMIT 200`,
        [user.fleetId, status ?? null],
      )
      .then((r) => r.rows);
  }

  /**
   * Looks at every driver with a trip in progress and makes the alert table say what is true now (ADR 0004).
   *
   * This runs on a schedule, not when a position arrives, because the most important alert is the absence of one. It is
   * idempotent -- opening is `ON CONFLICT DO NOTHING` against a partial unique index, clearing is an UPDATE of rows that are
   * still open -- so two workers running it at once is wasteful but never wrong, and nothing needs leader election.
   * Only a row that actually changed is announced, so re-evaluating every few seconds never repeats a notification.
   */
  async evaluate(): Promise<EvaluationSummary> {
    const now = this.clock.now();
    const { rows } = await this.db.query<Candidate>(
      `SELECT tr.driver_id, tr.fleet_id, tr.id AS trip_id, tr.status AS trip_status, tr.started_at, tr.arrived_at,
              ST_Y(vp.geom::geometry) AS lat, ST_X(vp.geom::geometry) AS lng, vp.speed_kmh, vp.captured_at, vp.last_moved_at,
              ST_Y(dest.geom::geometry) AS dest_lat, ST_X(dest.geom::geometry) AS dest_lng, s.samples
         FROM trips tr
         JOIN places dest ON dest.id = tr.destination_id
         LEFT JOIN vehicle_positions vp ON vp.driver_id = tr.driver_id
         LEFT JOIN LATERAL (
           SELECT coalesce(jsonb_agg(jsonb_build_object('s', q.speed_kmh, 'a', q.accuracy_m)), '[]'::jsonb) AS samples
             FROM (SELECT speed_kmh, accuracy_m FROM pings p
                    WHERE p.driver_id = tr.driver_id AND p.captured_at > $1::timestamptz - interval '30 minutes'
                    ORDER BY p.captured_at DESC LIMIT 20) q
         ) s ON true
        WHERE tr.status IN ('ACCEPTED', 'IN_TRANSIT')`,
      [now.toISOString()],
    );

    let opened = 0;
    let cleared = 0;
    for (const row of rows) {
      const desired = await this.desiredFor(row, now);
      const changed = await this.reconcile(row, desired, now);
      opened += changed.opened;
      cleared += changed.cleared;
    }
    cleared += await this.clearOrphans(now);
    if (opened || cleared)
      this.logger.log(`alerts: ${opened} opened, ${cleared} cleared (${rows.length} drivers evaluated)`);
    return { evaluated: rows.length, opened, cleared };
  }

  private async desiredFor(row: Candidate, now: Date): Promise<Desired> {
    const hasPosition = row.lat !== null && row.lng !== null;
    // Straight-line only: an alert must not depend on, or load, an outside router every few seconds for every driver.
    const samples: SpeedSample[] = row.samples.map((x) => ({ speedKmh: x.s, accuracyM: x.a }));
    const eta =
      hasPosition && row.trip_status === 'IN_TRANSIT'
        ? await this.eta.estimate(
            { lat: row.lat as number, lng: row.lng as number },
            { lat: row.dest_lat, lng: row.dest_lng },
            samples,
            {
              useRouter: false,
            },
          )
        : null;
    const state: DriverState = {
      tripStatus: row.trip_status,
      tripStartedAt: row.started_at,
      capturedAt: row.captured_at,
      speedKmh: row.speed_kmh,
      lastMovedAt: row.last_moved_at,
      etaMinutes: eta?.minutes ?? null,
      arrived: row.arrived_at !== null,
    };
    return desiredAlerts(state, now, {
      noSignalMinutes: this.env.NO_SIGNAL_MINUTES,
      longStopMinutes: this.env.LONG_STOP_MINUTES,
      arrivingMinutes: this.env.ARRIVING_MINUTES,
      stoppedKmh: STOPPED_KMH,
    });
  }

  private async reconcile(
    row: Candidate,
    desired: Desired,
    now: Date,
  ): Promise<{ opened: number; cleared: number }> {
    const kinds = Object.keys(desired) as AlertKind[];
    return this.db.tx(async (tx) => {
      let opened = 0;
      for (const kind of kinds) {
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO alerts (fleet_id, driver_id, trip_id, kind, opened_at, detail)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (driver_id, kind) WHERE status = 'open' DO NOTHING
           RETURNING id`,
          [row.fleet_id, row.driver_id, row.trip_id, kind, now.toISOString(), JSON.stringify(desired[kind])],
        );
        const created = inserted.rows[0];
        if (!created) continue;
        opened += 1;
        await publish(tx, {
          event: EVENTS.ALERT_OPENED,
          fleetId: row.fleet_id,
          driverId: row.driver_id,
          payload: {
            id: created.id,
            driver_id: row.driver_id,
            trip_id: row.trip_id,
            kind,
            detail: desired[kind] ?? {},
          },
        });
      }
      const closed = await tx.query<{ id: string; kind: AlertKind }>(
        `UPDATE alerts SET status = 'cleared', cleared_at = $3
          WHERE driver_id = $1 AND status = 'open' AND kind <> ALL($2::text[])
          RETURNING id, kind`,
        [row.driver_id, kinds, now.toISOString()],
      );
      for (const alert of closed.rows) {
        await publish(tx, {
          event: EVENTS.ALERT_CLEARED,
          fleetId: row.fleet_id,
          driverId: row.driver_id,
          payload: { id: alert.id, driver_id: row.driver_id, kind: alert.kind },
        });
      }
      return { opened, cleared: closed.rowCount ?? 0 };
    });
  }

  /** Alerts of drivers who no longer have a trip in progress are over: nobody is "silent" about a trip that ended. */
  private async clearOrphans(now: Date): Promise<number> {
    return this.db.tx(async (tx) => {
      const closed = await tx.query<{ id: string; fleet_id: string; driver_id: string; kind: AlertKind }>(
        `UPDATE alerts a SET status = 'cleared', cleared_at = $1
          WHERE a.status = 'open'
            AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = a.driver_id AND t.status IN ('ACCEPTED', 'IN_TRANSIT'))
          RETURNING a.id, a.fleet_id, a.driver_id, a.kind`,
        [now.toISOString()],
      );
      for (const alert of closed.rows) {
        await publish(tx, {
          event: EVENTS.ALERT_CLEARED,
          fleetId: alert.fleet_id,
          driverId: alert.driver_id,
          payload: { id: alert.id, driver_id: alert.driver_id, kind: alert.kind },
        });
      }
      return closed.rowCount ?? 0;
    });
  }
}
