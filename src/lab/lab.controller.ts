import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, Public } from '../common/auth';
import { AppException, notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, type Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AlertsService } from '../modules/alerts/alerts.service';
import { IdentityService } from '../modules/identity/identity.service';
import { MaintenanceService } from '../modules/maintenance/maintenance.service';
import { TripsService } from '../modules/trips/trips.service';
import { RoutingService } from '../routing/routing.service';
import { LabGate } from './lab.gate';
import { resetDemo } from './seed';

const sessionSchema = z
  .object({ email: z.string().toLowerCase().endsWith('.example.test').max(254) })
  .strict();
const phoneSchema = z
  .object({
    driver_email: z.string().toLowerCase().endsWith('.example.test').max(254),
    mode: z.enum([
      'online',
      'offline',
      'resume',
      'dead',
      'stopped',
      'drive',
      'jitter',
      'bad_clock',
      'teleport',
    ]),
  })
  .strict();
const routerSchema = z
  .object({ mode: z.enum(['ok', 'down', 'slow', 'hostile_geometry', 'absurd_distance', 'huge_body']) })
  .strict();
const replanSchema = z
  .object({ driver_email: z.string().toLowerCase().endsWith('.example.test').max(254) })
  .strict();

/**
 * The levers of the demonstration. Everything here either asks the REAL services to do what they do for any caller (evaluate
 * alerts, run maintenance, plan a trip), mints a token for a seeded demo user, or forwards an order to the field stand-in.
 * Nothing here evaluates anything a visitor typed, and nothing is reachable unless LAB_MODE is on (see `LabGate`).
 */
@Public()
@UseGuards(LabGate)
@Controller('api/lab')
export class LabController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AlertsService) private readonly alerts: AlertsService,
    @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(RoutingService) private readonly routing: RoutingService,
  ) {}

  @Get('state')
  async state() {
    const accounts = await this.db.query(
      `SELECT u.email, u.name, u.role, f.name AS fleet FROM users u JOIN fleets f ON f.id = u.fleet_id
        WHERE u.email LIKE '%.example.test' ORDER BY f.name, u.role DESC, u.email`,
    );
    const partitions = await this.db.query(
      `SELECT tableoid::regclass::text AS partition, count(*)::int AS pings FROM pings GROUP BY 1 ORDER BY 1`,
    );
    return {
      lab: true,
      password: this.env.DEMO_PASSWORD,
      accounts: accounts.rows,
      partitions: partitions.rows,
      thresholds: {
        no_signal_minutes: this.env.NO_SIGNAL_MINUTES,
        long_stop_minutes: this.env.LONG_STOP_MINUTES,
        arriving_minutes: this.env.ARRIVING_MINUTES,
        arrival_confirmations: this.env.ARRIVAL_CONFIRMATIONS,
        accuracy_limit_m: this.env.ACCURACY_LIMIT_M,
        retention_days: this.env.PING_RETENTION_DAYS,
        max_batch: this.env.PING_MAX_BATCH,
      },
      router: this.routing.status(),
    };
  }

  /** A token for a seeded demo user: what signing in as them would give, without typing the password. */
  @Post('session')
  @HttpCode(200)
  async session(@Body(new ZodPipe(sessionSchema)) body: { email: string }) {
    const { rows } = await this.db.query<{
      id: string;
      fleet_id: string;
      name: string;
      role: 'dispatcher' | 'driver';
    }>('SELECT id, fleet_id, name, role FROM users WHERE email = $1', [body.email]);
    const user = rows[0];
    if (!user) throw notFound('Demo user');
    return this.identity.session({ id: user.id, name: user.name, role: user.role, fleet_id: user.fleet_id });
  }

  @Post('reset')
  @HttpCode(200)
  async reset() {
    await resetDemo(
      this.db,
      this.env.PING_RETENTION_DAYS,
      this.env.DEMO_PASSWORD as string,
      this.env.PASSWORD_SCRYPT_LOG2_N,
    );
    this.routing.clearCache();
    await this.field('POST', '/control/reset').catch(() => undefined);
    return { status: 'reset' };
  }

  /** The evaluator the worker runs on a schedule, run now. Same code, same result. */
  @Post('evaluate')
  @HttpCode(200)
  evaluate() {
    return this.alerts.evaluate();
  }

  @Post('maintenance')
  @HttpCode(200)
  runMaintenance() {
    return this.maintenance.run();
  }

  @Get('field')
  fieldState() {
    return this.field('GET', '/control/state');
  }

  @Post('field/phone')
  @HttpCode(200)
  phone(@Body(new ZodPipe(phoneSchema)) body: unknown) {
    return this.field('POST', '/control/phone', body);
  }

  @Post('field/router')
  @HttpCode(200)
  router(@Body(new ZodPipe(routerSchema)) body: unknown) {
    this.routing.breaker.success(); // a new scenario starts with a closed breaker, so each press shows the cause, not the memory
    this.routing.clearCache();
    return this.field('POST', '/control/router', body);
  }

  /** Plans a fresh trip for a driver (their last one has finished), so the simulated phone has somewhere to go. */
  @Post('trips/replan')
  @HttpCode(200)
  async replan(@Body(new ZodPipe(replanSchema)) body: { driver_email: string }) {
    const { rows } = await this.db.query<{
      id: string;
      fleet_id: string;
      vehicle_id: string;
      here: string | null;
    }>(
      `SELECT u.id, u.fleet_id, u.vehicle_id,
              (SELECT t.destination_id FROM trips t WHERE t.driver_id = u.id AND t.status = 'COMPLETED' ORDER BY t.completed_at DESC LIMIT 1) AS here
         FROM users u WHERE u.email = $1 AND u.role = 'driver'`,
      [body.driver_email],
    );
    const driver = rows[0];
    if (!driver || !driver.vehicle_id) throw notFound('Demo driver');
    const places = await this.db.query<{ id: string }>(
      'SELECT id FROM places WHERE fleet_id = $1 ORDER BY random()',
      [driver.fleet_id],
    );
    const origin = driver.here ?? places.rows[0]?.id;
    const destination = places.rows.find((p) => p.id !== origin)?.id;
    if (!origin || !destination) throw notFound('Places');
    const dispatcher: AuthUser = { userId: driver.id, fleetId: driver.fleet_id, role: 'dispatcher' };
    return this.trips.create(dispatcher, {
      vehicle_id: driver.vehicle_id,
      driver_id: driver.id,
      origin_id: origin,
      destination_id: destination,
      planned_departure: new Date().toISOString(),
      expected_arrival: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
  }

  private async field(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    if (!this.env.FIELD_URL)
      throw new AppException(503, 'FIELD_UNAVAILABLE', 'No field stand-in is configured (FIELD_URL)');
    try {
      const response = await fetch(`${this.env.FIELD_URL.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new AppException(
        502,
        'FIELD_UNAVAILABLE',
        `The field stand-in did not answer: ${(error as Error).name}`,
      );
    }
  }
}
