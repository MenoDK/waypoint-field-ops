import type { Tx } from '../database/database.service';
import { hashPassword } from '../modules/identity/password';
import { TOWNS } from '../standin/world';
import { DEMO_FLEETS, type DemoFleet, dispatcherEmail } from './demo-accounts';

interface Runner {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface SeededFleet {
  fleetId: string;
  dispatcher: { id: string; email: string };
  drivers: { id: string; email: string; name: string; vehicleId: string; vehicle: string }[];
  places: Record<string, string>;
  unitId: string | null;
}

export interface SeedOptions {
  fleetName: string;
  /** Used to build the e-mail addresses: dispatcher@<slug>.example.test, driver1@<slug>.example.test ... */
  slug: string;
  driverNames: string[];
  vehiclePrefix: string;
  password: string;
  scryptLog2N: number;
  unit?: { name: string; capacity: number | null };
}

/**
 * Creates one fleet with a dispatcher, drivers (each with a vehicle), the made-up region's towns as places, and optionally a
 * mobile unit. The same function builds the demonstration and the fleets the tests arrange, so what the tests exercise is
 * what a visitor sees. Everything here is invented: the addresses end in `.example.test`, which can never be a real mailbox.
 */
export async function seedFleet(db: Runner, options: SeedOptions): Promise<SeededFleet> {
  const hash = await hashPassword(options.password, options.scryptLog2N);
  const fleet = await db.query<{ id: string }>('INSERT INTO fleets (name) VALUES ($1) RETURNING id', [
    options.fleetName,
  ]);
  const fleetId = (fleet.rows[0] as { id: string }).id;

  const dispatcherEmail = `dispatcher@${options.slug}.example.test`;
  const dispatcher = await db.query<{ id: string }>(
    `INSERT INTO users (fleet_id, email, name, role, password_hash) VALUES ($1, $2, $3, 'dispatcher', $4) RETURNING id`,
    [fleetId, dispatcherEmail, 'Dispatch Desk', hash],
  );

  const drivers: SeededFleet['drivers'] = [];
  for (const [index, name] of options.driverNames.entries()) {
    const label = `${options.vehiclePrefix}-${101 + index}`;
    const vehicle = await db.query<{ id: string }>(
      'INSERT INTO vehicles (fleet_id, label) VALUES ($1, $2) RETURNING id',
      [fleetId, label],
    );
    const vehicleId = (vehicle.rows[0] as { id: string }).id;
    const email = `driver${index + 1}@${options.slug}.example.test`;
    const driver = await db.query<{ id: string }>(
      `INSERT INTO users (fleet_id, email, name, role, vehicle_id, password_hash) VALUES ($1, $2, $3, 'driver', $4, $5) RETURNING id`,
      [fleetId, email, name, vehicleId, hash],
    );
    drivers.push({ id: (driver.rows[0] as { id: string }).id, email, name, vehicleId, vehicle: label });
  }

  const places: Record<string, string> = {};
  for (const town of TOWNS) {
    const row = await db.query<{ id: string }>(
      `INSERT INTO places (fleet_id, name, geom, radius_m) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 150) RETURNING id`,
      [fleetId, town.name, town.lat, town.lng],
    );
    places[town.name] = (row.rows[0] as { id: string }).id;
  }

  let unitId: string | null = null;
  if (options.unit) {
    const unit = await db.query<{ id: string }>(
      'INSERT INTO units (fleet_id, name, capacity) VALUES ($1, $2, $3) RETURNING id',
      [fleetId, options.unit.name, options.unit.capacity],
    );
    unitId = (unit.rows[0] as { id: string }).id;
  }
  return {
    fleetId,
    dispatcher: { id: (dispatcher.rows[0] as { id: string }).id, email: dispatcherEmail },
    drivers,
    places,
    unitId,
  };
}

/** One trip per driver, between towns that are some kilometres apart, planned to leave now. */
const ROUTES: [string, string][] = [
  ['Harbor Yard', 'Elm Crossing'],
  ['Stonegate', 'Ridgeway'],
  ['Fairview', 'Summit'],
  ['Lakeside', 'Cedar Point'],
];

export async function planDemoTrips(db: Runner, fleet: SeededFleet): Promise<void> {
  for (const [index, driver] of fleet.drivers.entries()) {
    const [from, to] = ROUTES[index % ROUTES.length] as [string, string];
    await db.query(
      `INSERT INTO trips (fleet_id, vehicle_id, driver_id, origin_id, destination_id, planned_departure, expected_arrival)
       VALUES ($1, $2, $3, $4, $5, now(), now() + interval '2 hours')`,
      [fleet.fleetId, driver.vehicleId, driver.id, fleet.places[from], fleet.places[to]],
    );
  }
}

/** The demonstration: two fleets that must never see each other, one with a mobile unit that holds a few people. */
export async function seedDemo(db: Runner, password: string, scryptLog2N: number): Promise<boolean> {
  const first = DEMO_FLEETS[0] as DemoFleet;
  const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [dispatcherEmail(first.slug)]);
  if (exists.rows.length > 0) return false;

  for (const demo of DEMO_FLEETS) {
    const fleet = await seedFleet(db, {
      fleetName: demo.name,
      slug: demo.slug,
      driverNames: demo.drivers,
      vehiclePrefix: demo.vehiclePrefix,
      password,
      scryptLog2N,
      unit: demo.unit,
    });
    await planDemoTrips(db, fleet); // every simulated phone has somewhere to go the moment it signs in
  }
  return true;
}

/** Arbitrary constant naming the lock that serialises the boot-time seed between API replicas. */
const SEED_LOCK_KEY = 7_410_201;

/**
 * Seeds the demonstration at start-up. Several API replicas may boot together; a transaction-scoped advisory lock makes the
 * second one wait for the first and then find the data already there, so the demonstration is created exactly once.
 * Returns whether this call created it.
 */
export async function seedDemoLocked(
  db: { tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> },
  password: string,
  scryptLog2N: number,
): Promise<boolean> {
  return db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
    return seedDemo(tx, password, scryptLog2N);
  });
}

/**
 * Empties every table the demonstration writes to, then seeds again. History is append-only for the application role, so
 * the pings are removed the only way it can: by dropping their partitions and creating fresh ones.
 */
export async function resetDemo(
  db: Runner,
  retentionDays: number,
  password: string,
  scryptLog2N: number,
): Promise<void> {
  for (const table of [
    'alerts',
    'tickets',
    'units',
    'vehicle_positions',
    'trips',
    'users',
    'vehicles',
    'places',
    'fleets',
    'rate_limits',
  ]) {
    await db.query(`DELETE FROM ${table}`);
  }
  await db.query(`SELECT drop_ping_partitions_before('infinity'::timestamptz)`);
  await db.query('SELECT ensure_ping_partitions($1, 3)', [retentionDays]);
  await seedDemo(db, password, scryptLog2N);
}
