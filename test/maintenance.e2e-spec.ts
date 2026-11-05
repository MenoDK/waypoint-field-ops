import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import {
  type Arranged,
  arrangeFleet,
  closeOwner,
  createHarness,
  type Harness,
  ping,
  sendPings,
  wipe,
} from './support/harness';

const dayName = (daysAgo: number): string => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `pings_${d.toISOString().slice(0, 10).replace(/-/g, '')}`;
};

describe('retention and housekeeping', () => {
  let h: Harness;
  let maintenance: MaintenanceService;
  beforeAll(async () => {
    h = await createHarness();
    maintenance = h.app.get(MaintenanceService);
  });
  afterAll(async () => {
    await maintenance.ensurePartitions(); // leave the database as the other specs expect it
    await h.close();
    await closeOwner();
  });

  let f: Arranged;
  beforeEach(async () => {
    await wipe(h);
    await maintenance.ensurePartitions();
    f = await arrangeFleet(h);
  });

  const partitions = async (): Promise<string[]> =>
    (
      await h.owner.query(
        `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'public.pings'::regclass ORDER BY c.relname`,
      )
    ).rows.map((r: { relname: string }) => r.relname);

  /** Writes one old reading straight into history, as the owner (the application role cannot, by design). */
  async function historicReading(daysAgo: number): Promise<void> {
    await h.owner.query('SELECT ensure_ping_partitions(30, 0)');
    const d = f.drivers[0] as { id: string; vehicleId: string };
    await h.owner.query(
      `INSERT INTO pings (driver_id, captured_at, fleet_id, vehicle_id, geom, source)
       VALUES ($1, now() - make_interval(days => $2), $3, $4, ST_SetSRID(ST_MakePoint(-98.1, 38.4), 4326)::geography, 'polling')`,
      [d.id, daysAgo, f.fleetId, d.vehicleId],
    );
  }
  const rowsInHistory = async (): Promise<number> =>
    Number((await h.owner.query('SELECT count(*) FROM pings')).rows[0].count);

  it('keeps a rolling window of partitions: the retention days behind, a few days ahead', async () => {
    const names = await partitions();
    expect(names).toContain(dayName(0));
    expect(names).toContain(dayName(h.env.PING_RETENTION_DAYS));
    expect(names).toContain(dayName(-3));
    expect(await maintenance.partitionsAhead()).toBeGreaterThanOrEqual(3);
  });

  it('retires history by dropping whole days -- instantly, and only the days that are entirely past the window', async () => {
    await historicReading(20); // far beyond retention
    await historicReading(9);
    await historicReading(1); // inside the window
    expect(await rowsInHistory()).toBe(3);

    const summary = await maintenance.run();
    expect(summary.partitions_dropped).toBeGreaterThanOrEqual(2);
    const names = await partitions();
    expect(names).not.toContain(dayName(20));
    expect(names).not.toContain(dayName(9));
    expect(names).toContain(dayName(1));
    expect(await rowsInHistory()).toBe(1); // the recent reading survived, the old ones are gone with their days
  });

  it('never drops a day that is partly inside the window', async () => {
    await maintenance.run();
    // the day exactly `retention` days ago still holds readings newer than the cutoff
    expect(await partitions()).toContain(dayName(h.env.PING_RETENTION_DAYS));
  });

  it('is idempotent: running it again changes nothing', async () => {
    await maintenance.run();
    const again = await maintenance.run();
    expect(again).toMatchObject({ partitions_created: 0, partitions_dropped: 0 });
  });

  it('forgets last-known positions after a day: an old location is still a location', async () => {
    await sendPings(h, f, [ping(h, 0)]).expect(200);
    const live = async () =>
      Number((await h.owner.query('SELECT count(*) FROM vehicle_positions')).rows[0].count);
    expect(await live()).toBe(1);
    await maintenance.run();
    expect(await live()).toBe(1); // fresh: kept
    h.clock.advanceMinutes(25 * 60);
    const summary = await maintenance.run();
    expect(summary.stale_positions_removed).toBe(1);
    expect(await live()).toBe(0);
  });

  it('purges expired rate-limit counters', async () => {
    await h.owner.query(
      "INSERT INTO rate_limits (key, count, expires_at) VALUES ('old', 3, now() - interval '1 minute')",
    );
    const summary = await maintenance.run();
    expect(summary.rate_limits_removed).toBeGreaterThanOrEqual(1);
  });

  describe('readiness notices a missing partition before midnight does', () => {
    it('turns /health/ready red when the newest partition is today, and green again after maintenance', async () => {
      await h.api().get('/health/ready').expect(200);
      const ahead = (await partitions()).filter((n) => n > dayName(0));
      for (const name of ahead) await h.owner.query(`DROP TABLE ${name}`);
      try {
        const red = await h.api().get('/health/ready').expect(503);
        expect(red.body.checks).toMatchObject({ partitions_ahead_days: 0 });
      } finally {
        await maintenance.ensurePartitions();
      }
      await h.api().get('/health/ready').expect(200);
    });
  });

  it('answers /health/live without touching the database', async () => {
    await h.api().get('/health/live').expect(200, { status: 'ok' });
  });
});
