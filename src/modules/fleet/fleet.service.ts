import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth';
import { Clock } from '../../common/clock';
import { notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import type { Eta, SpeedSample } from '../../geo/eta';
import { haversineKm, pathLengthKm, progressPercent } from '../../geo/geo';
import { EtaService } from './eta.service';

interface Row {
  driver_id: string;
  driver_name: string;
  vehicle_id: string | null;
  vehicle: string | null;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  accuracy_m: number | null;
  captured_at: Date | null;
  last_moved_at: Date | null;
  trip_id: string | null;
  trip_status: 'ACCEPTED' | 'IN_TRANSIT' | null;
  arrived_at: Date | null;
  origin: string | null;
  destination: string | null;
  orig_lat: number | null;
  orig_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  samples: { s: number | null; a: number | null }[];
}

export type Signal = 'online' | 'stale' | 'offline';
export type Motion = 'moving' | 'stopped' | 'unknown';

export interface VehicleView {
  driver_id: string;
  driver_name: string;
  vehicle_id: string | null;
  vehicle: string | null;
  position: {
    lat: number;
    lng: number;
    speed_kmh: number | null;
    heading_deg: number | null;
    accuracy_m: number | null;
    captured_at: string;
  } | null;
  signal: Signal;
  motion: Motion;
  age_seconds: number | null;
  trip: {
    id: string;
    status: 'ACCEPTED' | 'IN_TRANSIT';
    origin: string;
    destination: string;
    arrived_at: string | null;
    progress_percent: number | null;
  } | null;
  eta: Eta | null;
}

/** Past this many minutes without a reading a vehicle is "stale": probably fine, but no longer proven to be. */
const ONLINE_MINUTES = 5;
/** At or below this the vehicle is standing still (GPS speed is noisy near zero). */
export const STOPPED_KMH = 2;

@Injectable()
export class FleetService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(EtaService) private readonly eta: EtaService,
  ) {}

  /**
   * Everyone in the fleet, where they are and when they will arrive. One query: the live position is a row per driver (not
   * a scan of history), and the recent speed readings come from a lateral subquery that walks each driver's own index.
   */
  async snapshot(
    user: AuthUser,
  ): Promise<{ generated_at: string; router: ReturnType<EtaService['status']>; vehicles: VehicleView[] }> {
    const now = this.clock.now();
    const { rows } = await this.db.query<Row>(
      `SELECT u.id AS driver_id, u.name AS driver_name, v.id AS vehicle_id, v.label AS vehicle,
              ST_Y(vp.geom::geometry) AS lat, ST_X(vp.geom::geometry) AS lng,
              vp.speed_kmh, vp.heading_deg, vp.accuracy_m, vp.captured_at, vp.last_moved_at,
              tr.id AS trip_id, tr.status AS trip_status, tr.arrived_at,
              orig.name AS origin, ST_Y(orig.geom::geometry) AS orig_lat, ST_X(orig.geom::geometry) AS orig_lng,
              dest.name AS destination, ST_Y(dest.geom::geometry) AS dest_lat, ST_X(dest.geom::geometry) AS dest_lng,
              s.samples
         FROM users u
         LEFT JOIN vehicles v ON v.id = u.vehicle_id AND v.fleet_id = u.fleet_id
         LEFT JOIN vehicle_positions vp ON vp.driver_id = u.id
         LEFT JOIN trips tr ON tr.driver_id = u.id AND tr.status IN ('ACCEPTED', 'IN_TRANSIT')
         LEFT JOIN places orig ON orig.id = tr.origin_id
         LEFT JOIN places dest ON dest.id = tr.destination_id
         LEFT JOIN LATERAL (
           SELECT coalesce(jsonb_agg(jsonb_build_object('s', q.speed_kmh, 'a', q.accuracy_m)), '[]'::jsonb) AS samples
             FROM (SELECT speed_kmh, accuracy_m FROM pings p
                    WHERE p.driver_id = u.id AND p.captured_at > $2::timestamptz - interval '30 minutes'
                    ORDER BY p.captured_at DESC LIMIT 20) q
         ) s ON true
        WHERE u.fleet_id = $1 AND u.role = 'driver'
        ORDER BY u.name`,
      [user.fleetId, now.toISOString()],
    );
    const vehicles = await Promise.all(rows.map((row) => this.view(row, now)));
    return { generated_at: now.toISOString(), router: this.eta.status(), vehicles };
  }

  private async view(row: Row, now: Date): Promise<VehicleView> {
    const hasPosition = row.lat !== null && row.lng !== null && row.captured_at !== null;
    const ageSeconds = row.captured_at
      ? Math.max(0, Math.round((now.getTime() - row.captured_at.getTime()) / 1000))
      : null;
    const ageMinutes = ageSeconds === null ? Infinity : ageSeconds / 60;

    const signal: Signal =
      ageMinutes <= ONLINE_MINUTES
        ? 'online'
        : ageMinutes <= this.env.NO_SIGNAL_MINUTES
          ? 'stale'
          : 'offline';
    const motion: Motion =
      row.speed_kmh === null || !hasPosition
        ? 'unknown'
        : row.speed_kmh <= STOPPED_KMH
          ? 'stopped'
          : 'moving';

    let eta: Eta | null = null;
    let progress: number | null = null;
    if (hasPosition && row.trip_id && row.dest_lat !== null && row.dest_lng !== null) {
      const here = { lat: row.lat as number, lng: row.lng as number };
      const dest = { lat: row.dest_lat, lng: row.dest_lng };
      if (row.orig_lat !== null && row.orig_lng !== null) {
        const total = haversineKm({ lat: row.orig_lat, lng: row.orig_lng }, dest);
        progress = progressPercent(total, haversineKm(here, dest));
      }
      if (row.trip_status === 'IN_TRANSIT' && !row.arrived_at) {
        const samples: SpeedSample[] = row.samples.map((s) => ({ speedKmh: s.s, accuracyM: s.a }));
        eta = await this.eta.estimate(here, dest, samples, { useRouter: true });
      }
    }

    return {
      driver_id: row.driver_id,
      driver_name: row.driver_name,
      vehicle_id: row.vehicle_id,
      vehicle: row.vehicle,
      position: hasPosition
        ? {
            lat: row.lat as number,
            lng: row.lng as number,
            speed_kmh: row.speed_kmh,
            heading_deg: row.heading_deg,
            accuracy_m: row.accuracy_m,
            captured_at: (row.captured_at as Date).toISOString(),
          }
        : null,
      signal,
      motion,
      age_seconds: ageSeconds,
      trip: row.trip_id
        ? {
            id: row.trip_id,
            status: row.trip_status as 'ACCEPTED' | 'IN_TRANSIT',
            origin: row.origin ?? '',
            destination: row.destination ?? '',
            arrived_at: row.arrived_at?.toISOString() ?? null,
            progress_percent: progress,
          }
        : null,
      eta,
    };
  }

  /** The route a trip actually took: accurate fixes only, in order, thinned to a bounded size. */
  async trail(user: AuthUser, tripId: string) {
    const trip = await this.db.query('SELECT 1 FROM trips WHERE id = $1 AND fleet_id = $2', [
      tripId,
      user.fleetId,
    ]);
    if (trip.rowCount === 0) throw notFound('Trip');

    const { rows } = await this.db.query<{ lat: number; lng: number; captured_at: Date }>(
      `SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, captured_at
         FROM pings WHERE trip_id = $1 AND (accuracy_m IS NULL OR accuracy_m <= $2) ORDER BY captured_at LIMIT 20000`,
      [tripId, this.env.ACCURACY_LIMIT_M],
    );
    const all = rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), captured_at: r.captured_at }));
    const MAX_POINTS = 2000;
    const step = Math.max(1, Math.ceil(all.length / MAX_POINTS));
    const thinned = all.filter((_, i) => i % step === 0 || i === all.length - 1);
    return {
      trip_id: tripId,
      fixes: all.length,
      length_km: Math.round(pathLengthKm(all) * 100) / 100,
      geometry: { type: 'LineString' as const, coordinates: thinned.map((p) => [p.lng, p.lat]) },
    };
  }

  /** What a dispatcher needs to schedule a trip, in one call. */
  async catalog(user: AuthUser) {
    const [vehicles, drivers, places, units] = await Promise.all([
      this.db.query('SELECT id, label FROM vehicles WHERE fleet_id = $1 ORDER BY label', [user.fleetId]),
      this.db.query(
        `SELECT id, name, vehicle_id FROM users WHERE fleet_id = $1 AND role = 'driver' ORDER BY name`,
        [user.fleetId],
      ),
      this.db.query(
        `SELECT id, name, radius_m, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng FROM places WHERE fleet_id = $1 ORDER BY name`,
        [user.fleetId],
      ),
      this.db.query('SELECT id, name, capacity FROM units WHERE fleet_id = $1 ORDER BY name', [user.fleetId]),
    ]);
    return { vehicles: vehicles.rows, drivers: drivers.rows, places: places.rows, units: units.rows };
  }
}
