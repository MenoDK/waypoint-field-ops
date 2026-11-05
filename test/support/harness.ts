import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { Clock } from '../../src/common/clock';
import { type Env, ENV } from '../../src/config/env';
import { type SeededFleet, type SeedOptions, seedFleet } from '../../src/lab/seed';

export const PASSWORD = 'Test-password-for-fleets-1';
export const OWNER_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:15450/waypoint';

/** A clock the test can move. "Fifteen minutes of silence" becomes one line instead of a fifteen-minute wait. */
export class TestClock extends Clock {
  private current: number;

  constructor(start: Date = new Date()) {
    super();
    this.current = start.getTime();
  }

  override now(): Date {
    return new Date(this.current);
  }

  advanceMinutes(minutes: number): void {
    this.current += minutes * 60_000;
  }

  advanceSeconds(seconds: number): void {
    this.current += seconds * 1000;
  }

  /** `minutes` before now, as an ISO string: the way a phone stamps a reading. */
  agoIso(minutes: number): string {
    return new Date(this.current - minutes * 60_000).toISOString();
  }
}

/** A clock that follows real time, for specs where a separate client (the simulated phones) stamps readings with real time. */
export class LiveClock extends TestClock {
  override now(): Date {
    return new Date();
  }
}

export interface Harness {
  app: NestExpressApplication;
  env: Env;
  clock: TestClock;
  /** Connected as the database OWNER: for arranging data and for checking what the application wrote. */
  owner: Pool;
  /** supertest against the listening server. */
  api: () => ReturnType<typeof request>;
  /** The address of the listening server, e.g. for a WebSocket client. */
  url: string;
  token(user: { id: string; fleetId: string; role: 'dispatcher' | 'driver'; name?: string }): Promise<string>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Environment overrides for this application only (restored right after start-up). */
  env?: Record<string, string>;
  clock?: TestClock;
}

let sharedOwner: Pool | undefined;
function ownerPool(): Pool {
  sharedOwner ??= new Pool({ connectionString: OWNER_URL, max: 4 });
  return sharedOwner;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const clock = options.clock ?? new TestClock();
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  let app: NestExpressApplication;
  let env: Env;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    env = app.get<Env>(ENV);
    configureApp(app, env);
    // Always listen (on an ephemeral port): requests go over a real socket, exactly as in production, and WebSocket tests work.
    await app.listen(0, '127.0.0.1');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const jwt = app.get(JwtService);
  const address = app.getHttpServer().address();
  const url = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  return {
    app,
    env,
    clock,
    owner: ownerPool(),
    api: () => request(url),
    url,
    token: (user) => jwt.signAsync({ sub: user.id, fid: user.fleetId, role: user.role }),
    close: () => app.close(),
  };
}

/** Closes the shared owner pool: call once, in the last `afterAll` of a spec file. */
export async function closeOwner(): Promise<void> {
  await sharedOwner?.end();
  sharedOwner = undefined;
}

/**
 * Empties every table. For specs whose subject is global (the alert evaluator looks at EVERY fleet, retention drops partitions
 * for everyone), so leftovers from other specs cannot change their answer. Specs run one at a time, never concurrently.
 */
export async function wipe(h: Harness): Promise<void> {
  await h.owner.query(
    'TRUNCATE alerts, tickets, units, vehicle_positions, trips, pings, users, vehicles, places, fleets, rate_limits CASCADE',
  );
}

export interface Arranged extends SeededFleet {
  dispatcherToken: string;
  driverTokens: string[];
}

/** A fresh, uniquely named fleet: tests never share rows, so they cannot disturb each other. */
export async function arrangeFleet(h: Harness, overrides: Partial<SeedOptions> = {}): Promise<Arranged> {
  const slug = `t${randomBytes(4).toString('hex')}`;
  const fleet = await seedFleet(h.owner, {
    fleetName: `Fleet ${slug}`,
    slug,
    driverNames: ['Driver One', 'Driver Two'],
    vehiclePrefix: 'V',
    password: PASSWORD,
    scryptLog2N: 10,
    ...overrides,
  });
  const dispatcherToken = await h.token({
    id: fleet.dispatcher.id,
    fleetId: fleet.fleetId,
    role: 'dispatcher',
  });
  const driverTokens = await Promise.all(
    fleet.drivers.map((d) => h.token({ id: d.id, fleetId: fleet.fleetId, role: 'driver' })),
  );
  return { ...fleet, dispatcherToken, driverTokens };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

export interface PingBody {
  lat: number;
  lng: number;
  captured_at: string;
  accuracy_m?: number;
  speed_kmh?: number;
  heading_deg?: number;
  source?: 'checkin' | 'polling' | 'batch';
}

/** A valid reading near the first town of the made-up region, `minutesAgo` before the harness clock. */
export function ping(h: Harness, minutesAgo: number, over: Partial<PingBody> = {}): PingBody {
  return {
    lat: 38.4,
    lng: -98.12,
    captured_at: h.clock.agoIso(minutesAgo),
    accuracy_m: 10,
    speed_kmh: 40,
    ...over,
  };
}

/** Sends a batch as the driver at `index` and returns the whole response (status included). */
export function sendPings(h: Harness, f: Arranged, pings: PingBody[], index = 0) {
  return h
    .api()
    .post('/v1/pings')
    .set(...bearer(f.driverTokens[index] as string))
    .send({ pings });
}

/** Plans a trip as the dispatcher, between two of the made-up towns. Returns its id. */
export async function planTrip(
  h: Harness,
  f: Arranged,
  index = 0,
  from = 'Harbor Yard',
  to = 'Elm Crossing',
): Promise<string> {
  const driver = f.drivers[index] as Arranged['drivers'][number];
  const response = await h
    .api()
    .post('/v1/trips')
    .set(...bearer(f.dispatcherToken))
    .send({
      vehicle_id: driver.vehicleId,
      driver_id: driver.id,
      origin_id: f.places[from],
      destination_id: f.places[to],
      planned_departure: h.clock.agoIso(0),
      expected_arrival: new Date(h.clock.now().getTime() + 2 * 3_600_000).toISOString(),
    });
  if (response.status !== 201)
    throw new Error(`planTrip failed: ${response.status} ${JSON.stringify(response.body)}`);
  return (response.body as { id: string }).id;
}

/** Plans, accepts and starts a trip. Returns its id. */
export async function startTrip(
  h: Harness,
  f: Arranged,
  index = 0,
  from?: string,
  to?: string,
): Promise<string> {
  const id = await planTrip(h, f, index, from, to);
  const token = f.driverTokens[index] as string;
  const accepted = await h
    .api()
    .post(`/v1/trips/${id}/accept`)
    .set(...bearer(token));
  if (accepted.status !== 200)
    throw new Error(`accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  const started = await h
    .api()
    .post(`/v1/trips/${id}/start`)
    .set(...bearer(token))
    .send({ km_start: 1000 });
  if (started.status !== 200)
    throw new Error(`start failed: ${started.status} ${JSON.stringify(started.body)}`);
  return id;
}
