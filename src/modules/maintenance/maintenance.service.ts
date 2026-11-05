import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { RateLimitService } from '../../common/rate-limit.service';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';

export interface MaintenanceSummary {
  partitions_created: number;
  partitions_dropped: number;
  stale_positions_removed: number;
  rate_limits_removed: number;
}

/** Positions of drivers who have not reported for this long leave the live table: a last-known location is still location. */
const POSITION_HORIZON_HOURS = 24;

/**
 * The housekeeping that keeps location data short-lived (ADR 0003). Every step is idempotent, so it can run at start-up, on
 * a schedule and from two workers at once without harm.
 *
 * Retention is by dropping whole daily partitions: instant, no dead rows, no vacuum. The application role cannot DROP or
 * DELETE history itself -- it can only call the narrow functions the migration defined.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /** Makes sure the partitions that ingest needs exist: the whole retention window behind, and a few days ahead. */
  async ensurePartitions(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>('SELECT ensure_ping_partitions($1, 3) AS n', [
      this.env.PING_RETENTION_DAYS,
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  /** How many days ahead the newest partition reaches (health: ingest breaks when this reaches zero). */
  async partitionsAhead(): Promise<number> {
    const { rows } = await this.db.query<{ ahead: number | null }>(
      `SELECT max(to_date(substr(c.relname, 7), 'YYYYMMDD')) - (now() AT TIME ZONE 'UTC')::date AS ahead
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'public.pings'::regclass AND c.relname ~ '^pings_[0-9]{8}$'`,
    );
    return Number(rows[0]?.ahead ?? -1);
  }

  async run(): Promise<MaintenanceSummary> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - this.env.PING_RETENTION_DAYS * 86_400_000);
    const created = await this.ensurePartitions();
    const dropped = await this.db.query<{ n: number }>('SELECT drop_ping_partitions_before($1) AS n', [
      cutoff.toISOString(),
    ]);
    const stale = await this.db.query(
      `DELETE FROM vehicle_positions WHERE captured_at < $1::timestamptz - make_interval(hours => $2)`,
      [now.toISOString(), POSITION_HORIZON_HOURS],
    );
    const limits = await this.limits.purgeExpired();
    const summary = {
      partitions_created: created,
      partitions_dropped: Number(dropped.rows[0]?.n ?? 0),
      stale_positions_removed: stale.rowCount ?? 0,
      rate_limits_removed: limits,
    };
    if (summary.partitions_created || summary.partitions_dropped || summary.stale_positions_removed) {
      this.logger.log(`maintenance: ${JSON.stringify(summary)}`);
    }
    return summary;
  }
}
