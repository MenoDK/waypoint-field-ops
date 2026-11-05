import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth';
import { Clock } from '../../common/clock';
import { conflict, notFound, unprocessable } from '../../common/errors';
import { DatabaseService, type Tx } from '../../database/database.service';
import { EVENTS, publish } from '../../realtime/events';
import {
  type Actor,
  check,
  checkOdometer,
  sourceStates,
  type TripAction,
  type TripStatus,
} from './trip-state';

export const createTripSchema = z
  .object({
    vehicle_id: z.uuid(),
    driver_id: z.uuid(),
    origin_id: z.uuid(),
    destination_id: z.uuid(),
    planned_departure: z.iso.datetime({ offset: true }),
    expected_arrival: z.iso.datetime({ offset: true }),
  })
  .strict();
export type CreateTripInput = z.infer<typeof createTripSchema>;

export const startTripSchema = z.object({ km_start: z.number().int().min(0).max(10_000_000) }).strict();
export const completeTripSchema = z.object({ km_end: z.number().int().min(1).max(10_000_000) }).strict();
export const noteSchema = z.object({ text: z.string().trim().min(1).max(500) }).strict();

export interface TripRow {
  id: string;
  fleet_id: string;
  vehicle_id: string;
  driver_id: string;
  origin_id: string;
  destination_id: string;
  status: TripStatus;
  planned_departure: Date;
  expected_arrival: Date;
  accepted_at: Date | null;
  started_at: Date | null;
  arrived_at: Date | null;
  completed_at: Date | null;
  km_start: number | null;
  km_end: number | null;
  notes: string;
}

const COLUMNS = `id, fleet_id, vehicle_id, driver_id, origin_id, destination_id, status, planned_departure, expected_arrival,
  accepted_at, started_at, arrived_at, completed_at, km_start, km_end, notes`;

@Injectable()
export class TripsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async create(user: AuthUser, input: CreateTripInput): Promise<TripRow> {
    if (new Date(input.expected_arrival) <= new Date(input.planned_departure)) {
      throw unprocessable('INVALID_SCHEDULE', 'expected_arrival must be after planned_departure');
    }
    return this.db.tx(async (tx) => {
      const driver = await tx.query('SELECT 1 FROM users WHERE id = $1 AND fleet_id = $2 AND role = $3', [
        input.driver_id,
        user.fleetId,
        'driver',
      ]);
      if (driver.rowCount === 0)
        throw unprocessable('NOT_A_DRIVER', 'driver_id is not a driver of this fleet');
      // The composite foreign keys (id, fleet_id) make the database refuse a vehicle or place of another fleet as well.
      const { rows } = await tx.query<TripRow>(
        `INSERT INTO trips (fleet_id, vehicle_id, driver_id, origin_id, destination_id, planned_departure, expected_arrival)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [
          user.fleetId,
          input.vehicle_id,
          input.driver_id,
          input.origin_id,
          input.destination_id,
          input.planned_departure,
          input.expected_arrival,
        ],
      );
      const trip = rows[0]!;
      await this.announce(tx, trip);
      return trip;
    });
  }

  list(user: AuthUser, status?: TripStatus): Promise<TripRow[]> {
    const mine = user.role === 'driver';
    return this.db
      .query<TripRow>(
        `SELECT ${COLUMNS} FROM trips
          WHERE fleet_id = $1 AND ($2::uuid IS NULL OR driver_id = $2) AND ($3::text IS NULL OR status = $3)
          ORDER BY planned_departure DESC LIMIT 200`,
        [user.fleetId, mine ? user.userId : null, status ?? null],
      )
      .then((r) => r.rows);
  }

  /** A trip is invisible outside its fleet -- and, for a driver, outside their own trips: both read as "not found". */
  async get(user: AuthUser, id: string): Promise<TripRow> {
    const trip = await this.find(this.db, user, id);
    if (!trip) throw notFound('Trip');
    return trip;
  }

  /**
   * Where a trip goes: its two places with coordinates and arrival radius. What a driver's app needs to navigate, and
   * visible under exactly the rule `get` uses -- a driver sees only their own trip's places, never the rest of the fleet's.
   */
  async route(user: AuthUser, id: string) {
    const trip = await this.get(user, id);
    const { rows } = await this.db.query<{
      id: string;
      name: string;
      radius_m: number;
      lat: number;
      lng: number;
    }>(
      `SELECT id, name, radius_m, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
         FROM places WHERE id = ANY($1::uuid[]) AND fleet_id = $2`,
      [[trip.origin_id, trip.destination_id], user.fleetId],
    );
    const place = (placeId: string) => {
      const row = rows.find((r) => r.id === placeId);
      return row ? { ...row, lat: Number(row.lat), lng: Number(row.lng) } : null;
    };
    return { trip_id: trip.id, origin: place(trip.origin_id), destination: place(trip.destination_id) };
  }

  accept(user: AuthUser, id: string) {
    return this.act('accept', user, id, {});
  }
  start(user: AuthUser, id: string, kmStart: number) {
    return this.act('start', user, id, { km_start: kmStart });
  }
  complete(user: AuthUser, id: string, kmEnd: number) {
    return this.act('complete', user, id, { km_end: kmEnd });
  }
  cancel(user: AuthUser, id: string) {
    return this.act('cancel', user, id, {});
  }

  /**
   * Moves a trip along its lifecycle. The pure table in `trip-state.ts` says whether the move is allowed; the UPDATE says it
   * again at the moment of writing (`WHERE status = <from>`, a compare-and-set), so two requests racing for the same
   * transition cannot both win: the second finds the row already moved and gets a 409. No lock is held between the read and
   * the write. The caller's identity is part of the read as well: a driver cannot touch a trip that is not theirs.
   */
  private async act(
    action: TripAction,
    user: AuthUser,
    id: string,
    extra: { km_start?: number; km_end?: number },
  ): Promise<TripRow> {
    const actor: Actor = user.role;
    return this.db.tx(async (tx) => {
      const trip = await this.find(tx, user, id);
      if (!trip) throw notFound('Trip');

      const verdict = check(action, actor, trip.status);
      if (!verdict.ok) {
        throw conflict('INVALID_STATE', `A ${trip.status} trip cannot be ${action}ed by a ${actor}`, {
          current: trip.status,
          expected_from: verdict.expectedFrom,
        });
      }
      if (action === 'complete' && extra.km_end !== undefined) {
        if (!checkOdometer(trip.km_start, extra.km_end).ok) {
          throw unprocessable(
            'ODOMETER_BACKWARDS',
            'km_end must be greater than the km_start recorded when the trip began',
            {
              km_start: trip.km_start,
            },
          );
        }
      }

      const now = this.clock.now();
      let updated;
      try {
        updated = await tx.query<TripRow>(
          `UPDATE trips SET
              status = $3,
              accepted_at  = CASE WHEN $3 = 'ACCEPTED'   THEN $5::timestamptz ELSE accepted_at END,
              started_at   = CASE WHEN $3 = 'IN_TRANSIT' THEN $5::timestamptz ELSE started_at END,
              completed_at = CASE WHEN $3 = 'COMPLETED'  THEN $5::timestamptz ELSE completed_at END,
              km_start     = COALESCE($6::integer, km_start),
              km_end       = COALESCE($7::integer, km_end),
              updated_at   = now()
            WHERE id = $1 AND fleet_id = $2 AND status = ANY($4::text[])
            RETURNING ${COLUMNS}`,
          [
            id,
            user.fleetId,
            verdict.to,
            sourceStates(action),
            now.toISOString(),
            extra.km_start ?? null,
            extra.km_end ?? null,
          ],
        );
      } catch (error) {
        // The partial unique indexes: a driver with another active trip, or a vehicle already moving.
        if ((error as { code?: string }).code === '23505') {
          throw conflict('ALREADY_ACTIVE', 'This driver or vehicle already has a trip in progress');
        }
        throw error;
      }
      const row = updated.rows[0];
      if (!row)
        throw conflict(
          'INVALID_STATE',
          'The trip changed while this request was being handled; reload and retry',
        );
      await this.announce(tx, row);
      return row;
    });
  }

  /**
   * Appends a line to the trip log. The append is done by the database in one statement, so two notes written at the same
   * moment both survive; a read-then-write in application code would keep only the last.
   */
  async addNote(user: AuthUser, id: string, text: string): Promise<TripRow> {
    const stamp = this.clock.now().toISOString().slice(11, 16);
    const line = `[${stamp}Z] ${text}`;
    const { rows } = await this.db.query<TripRow>(
      `UPDATE trips SET notes = CASE WHEN notes = '' THEN $3 ELSE notes || E'\\n' || $3 END, updated_at = now()
        WHERE id = $1 AND fleet_id = $2 AND driver_id = $4 AND status IN ('ACCEPTED', 'IN_TRANSIT')
        RETURNING ${COLUMNS}`,
      [id, user.fleetId, line, user.userId],
    );
    if (!rows[0]) {
      await this.get(user, id); // 404 if it is not theirs ...
      throw conflict('INVALID_STATE', 'Notes can only be added to an accepted or running trip'); // ... otherwise the state is wrong
    }
    return rows[0];
  }

  private async find(
    runner: Pick<Tx, 'query'> | DatabaseService,
    user: AuthUser,
    id: string,
  ): Promise<TripRow | undefined> {
    const { rows } = await runner.query<TripRow>(
      `SELECT ${COLUMNS} FROM trips WHERE id = $1 AND fleet_id = $2 AND ($3::uuid IS NULL OR driver_id = $3)`,
      [id, user.fleetId, user.role === 'driver' ? user.userId : null],
    );
    return rows[0];
  }

  private async announce(tx: Tx, trip: TripRow): Promise<void> {
    await publish(tx, {
      event: EVENTS.TRIP_UPDATED,
      fleetId: trip.fleet_id,
      driverId: trip.driver_id,
      payload: {
        trip_id: trip.id,
        driver_id: trip.driver_id,
        vehicle_id: trip.vehicle_id,
        status: trip.status,
      },
    });
  }
}
