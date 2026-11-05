import { Client } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { PingsService } from '../src/modules/pings/pings.service';
import { TOWNS } from '../src/standin/world';
import {
  type Arranged,
  arrangeFleet,
  bearer,
  closeOwner,
  createHarness,
  type Harness,
  OWNER_URL,
  ping,
  sendPings,
  startTrip,
  wipe,
} from './support/harness';

const town = (name: string) => TOWNS.find((t) => t.name === name) as (typeof TOWNS)[number];

/** Polls until `condition` holds, so a test waits for a state of the database instead of for a number of milliseconds. */
async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('alerts and arrival', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
    await closeOwner();
  });

  let f: Arranged;
  beforeEach(async () => {
    await wipe(h); // the evaluator looks at every fleet: nothing left over from another test may change its answer
    f = await arrangeFleet(h);
  });

  const evaluate = () => h.app.get(AlertsService).evaluate();
  const alerts = async (status: 'open' | 'cleared' = 'open', token = f.dispatcherToken) =>
    (
      await h
        .api()
        .get(`/v1/alerts?status=${status}`)
        .set(...bearer(token))
        .expect(200)
    ).body as {
      kind: string;
      detail: Record<string, unknown>;
    }[];
  const driverId = () => (f.drivers[0] as { id: string }).id;
  const arrivedAt = async (tripId: string) =>
    (await h.owner.query('SELECT arrived_at FROM trips WHERE id = $1', [tripId])).rows[0]
      .arrived_at as Date | null;
  /** How many of the application's connections are stuck behind a row lock right now. */
  const waitingOnALock = async (): Promise<number> =>
    Number(
      (
        await h.owner.query(
          "SELECT count(*) FROM pg_stat_activity WHERE usename = 'app_user' AND wait_event_type = 'Lock'",
        )
      ).rows[0].count,
    );

  describe('no signal', () => {
    it('opens only after the silence passes the threshold, and not twice', async () => {
      await startTrip(h, f);
      await sendPings(h, f, [ping(h, 0, { speed_kmh: 50 })]).expect(200);

      h.clock.advanceMinutes(10);
      expect(await evaluate()).toMatchObject({ evaluated: 1, opened: 0 });

      h.clock.advanceMinutes(10); // 20 minutes since the last reading; the limit is 15
      expect(await evaluate()).toMatchObject({ opened: 1 });
      const open = await alerts();
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        kind: 'no_signal',
        detail: { silent_minutes: 20, never_reported: false },
      });

      expect(await evaluate()).toMatchObject({ opened: 0, cleared: 0 }); // looking again changes nothing
      expect(await alerts()).toHaveLength(1);
    });

    it('is opened by exactly one of three evaluators running at the same moment', async () => {
      await startTrip(h, f);
      h.clock.advanceMinutes(20);
      const runs = await Promise.all([evaluate(), evaluate(), evaluate()]);
      expect(runs.reduce((sum, r) => sum + r.opened, 0)).toBe(1);
      expect(await alerts()).toHaveLength(1);
    });

    it('fires for a phone that never reported at all', async () => {
      await startTrip(h, f);
      h.clock.advanceMinutes(16);
      await evaluate();
      expect((await alerts())[0]).toMatchObject({ kind: 'no_signal', detail: { never_reported: true } });
    });

    it('clears itself when the phone comes back', async () => {
      await startTrip(h, f);
      h.clock.advanceMinutes(30);
      await evaluate();
      expect(await alerts()).toHaveLength(1);

      await sendPings(h, f, [ping(h, 0)]).expect(200);
      expect(await evaluate()).toMatchObject({ cleared: 1 });
      expect(await alerts()).toHaveLength(0);
      expect(await alerts('cleared')).toHaveLength(1);
    });

    it('does not accuse a trip that has not started: the driver has only said yes', async () => {
      const id = await startTrip(h, f);
      // rewind the trip to ACCEPTED to look at the same driver before the start
      await h.owner.query(
        "UPDATE trips SET status = 'ACCEPTED', started_at = NULL, km_start = NULL WHERE id = $1",
        [id],
      );
      h.clock.advanceMinutes(120);
      expect(await evaluate()).toMatchObject({ opened: 0 });
    });

    it('ends with the trip: nobody is silent about a trip that is over', async () => {
      const id = await startTrip(h, f);
      h.clock.advanceMinutes(30);
      await evaluate();
      expect(await alerts()).toHaveLength(1);

      await h
        .api()
        .post(`/v1/trips/${id}/complete`)
        .set(...bearer(f.driverTokens[0] as string))
        .send({ km_end: 1100 })
        .expect(200);
      expect(await evaluate()).toMatchObject({ cleared: 1 });
      expect(await alerts()).toHaveLength(0);
    });
  });

  describe('long stop', () => {
    it('opens after a long standstill and clears when the vehicle moves again', async () => {
      await startTrip(h, f);
      h.clock.advanceMinutes(20);
      await sendPings(h, f, [ping(h, 0, { speed_kmh: 0 })]).expect(200);
      h.clock.advanceMinutes(12); // 32 minutes without moving; the limit is 30
      await sendPings(h, f, [ping(h, 0, { speed_kmh: 0 })]).expect(200);

      await evaluate();
      expect((await alerts()).map((a) => a.kind)).toEqual(['long_stop']);

      h.clock.advanceMinutes(1);
      await sendPings(h, f, [ping(h, 0, { speed_kmh: 40 })]).expect(200);
      expect(await evaluate()).toMatchObject({ cleared: 1 });
      expect(await alerts()).toHaveLength(0);
    });

    it('does not fire for a short stop', async () => {
      await startTrip(h, f);
      h.clock.advanceMinutes(10);
      await sendPings(h, f, [ping(h, 0, { speed_kmh: 0 })]).expect(200);
      await evaluate();
      expect(await alerts()).toHaveLength(0);
    });
  });

  describe('arriving soon', () => {
    it('opens when the straight-line ETA is inside the window, and not when the vehicle is far away', async () => {
      await startTrip(h, f); // Harbor Yard -> Elm Crossing
      const dest = town('Elm Crossing');
      await sendPings(h, f, [ping(h, 0, { lat: dest.lat + 0.9, lng: dest.lng, speed_kmh: 40 })]).expect(200); // ~100 km
      await evaluate();
      expect(await alerts()).toHaveLength(0);

      h.clock.advanceMinutes(1);
      await sendPings(h, f, [ping(h, 0, { lat: dest.lat + 0.027, lng: dest.lng, speed_kmh: 40 })]).expect(
        200,
      ); // ~3 km
      await evaluate();
      expect((await alerts()).map((a) => a.kind)).toEqual(['arriving_soon']);
    });
  });

  describe('arrival', () => {
    const dest = () => town('Elm Crossing');
    const inside = (h2: Harness, minutesAgo: number, over = {}) =>
      ping(h2, minutesAgo, { lat: dest().lat, lng: dest().lng, speed_kmh: 3, ...over });
    /** Starts the trip and lets ten minutes pass, so that readings stamped "a few minutes ago" belong to it. */
    const startRunning = async (): Promise<string> => {
      const id = await startTrip(h, f);
      h.clock.advanceMinutes(10);
      return id;
    };

    it('is declared once the last two accurate fixes are inside the radius -- not on the first', async () => {
      const id = await startRunning();
      await sendPings(h, f, [inside(h, 2)]).expect(200);
      expect(await arrivedAt(id)).toBeNull();
      await sendPings(h, f, [inside(h, 1)]).expect(200);
      expect(await arrivedAt(id)).not.toBeNull();
    });

    it('ignores fixes that are too inaccurate to prove anything', async () => {
      const id = await startRunning();
      const sloppy = (m: number) => inside(h, m, { accuracy_m: 900 });
      await sendPings(h, f, [sloppy(3), sloppy(2), sloppy(1)]).expect(200);
      expect((await h.owner.query('SELECT count(*) FROM pings WHERE trip_id = $1', [id])).rows[0].count).toBe(
        '3',
      ); // they ARE on the trip...
      expect(await arrivedAt(id)).toBeNull(); // ...but prove nothing
      await sendPings(h, f, [inside(h, 0.5), inside(h, 0.2)]).expect(200);
      expect(await arrivedAt(id)).not.toBeNull(); // and two good ones do
    });

    it('needs the fixes to be consecutive: a drive-by followed by leaving is not an arrival', async () => {
      const id = await startRunning();
      const away = { lat: dest().lat + 0.02, lng: dest().lng };
      await sendPings(h, f, [inside(h, 4), ping(h, 3, away), inside(h, 2)]).expect(200);
      expect(await arrivedAt(id)).toBeNull();
      await sendPings(h, f, [inside(h, 1)]).expect(200);
      expect(await arrivedAt(id)).not.toBeNull();
    });

    /** Listens on the bus channel the way the API's own listener does, and counts the arrivals that were announced. */
    const listenForArrivals = async () => {
      const client = new Client({ connectionString: OWNER_URL });
      await client.connect();
      let announced = 0;
      client.on('notification', (n) => {
        if ((JSON.parse(n.payload ?? '{}') as { event?: string }).event === 'trip.arrived') announced += 1;
      });
      await client.query('LISTEN waypoint_events');
      return {
        count: async () => {
          await client.query('SELECT 1'); // notifications queued on this connection are delivered before its next reply
          return announced;
        },
        stop: () => client.end(),
      };
    };

    it('is recorded once, however many requests see the same condition at the same moment', async () => {
      const id = await startRunning();
      const arrivals = await listenForArrivals();
      try {
        const runs = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            sendPings(h, f, [inside(h, 2 + i / 100), inside(h, 1 + i / 100)]),
          ),
        );
        expect(runs.map((r) => r.status)).toEqual(Array(8).fill(200));
        expect(await arrivedAt(id)).not.toBeNull();
        expect(await arrivals.count()).toBe(1); // eight requests, one announcement
      } finally {
        await arrivals.stop();
      }
    });

    // Requests from one driver already queue up behind each other at the live-position row, so over HTTP the second one finds
    // the arrival done before it looks. That makes the guard on the write itself impossible to see from outside -- yet it must
    // hold without leaning on a lock taken somewhere else. So this test takes the queue away: two transactions decide "arrived"
    // from the same fixes, both reach the write, and the test lets them through one after the other.
    it('lets exactly one of two transactions that both decided "arrived" stamp and announce it', async () => {
      const id = await startRunning();
      const driver = f.drivers[0] as Arranged['drivers'][number];
      for (const minutes of [2, 1]) {
        await h.owner.query(
          `INSERT INTO pings (driver_id, captured_at, fleet_id, vehicle_id, trip_id, geom, accuracy_m, speed_kmh, source)
           VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, 10, 3, 'polling')`,
          [driver.id, h.clock.agoIso(minutes), f.fleetId, driver.vehicleId, id, dest().lng, dest().lat],
        );
      }
      const user = { userId: driver.id, fleetId: f.fleetId, role: 'driver' as const };
      const service = h.app.get(PingsService);
      const db = h.app.get(DatabaseService);

      const arrivals = await listenForArrivals();
      const gate = await h.owner.connect();
      try {
        // Hold the trip row: both transactions read the fixes (a plain read is not blocked) and then wait at the write.
        await gate.query('BEGIN');
        await gate.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [id]);
        const both = Promise.all([
          db.tx((tx) => service['detectArrival'](tx, user)),
          db.tx((tx) => service['detectArrival'](tx, user)),
        ]);
        await waitFor(async () => (await waitingOnALock()) >= 2, 'both transactions to reach the write');
        await gate.query('COMMIT');
        await both;
      } finally {
        await gate.query('ROLLBACK').catch(() => undefined); // a failed test must not leave the row locked for the next one
        gate.release();
      }
      try {
        expect(await arrivedAt(id)).not.toBeNull();
        expect(await arrivals.count()).toBe(1);
      } finally {
        await arrivals.stop();
      }
    });

    it('ends the "arriving soon" alert', async () => {
      const id = await startRunning();
      await sendPings(h, f, [ping(h, 0, { lat: dest().lat + 0.027, lng: dest().lng, speed_kmh: 40 })]).expect(
        200,
      );
      await evaluate();
      expect((await alerts()).map((a) => a.kind)).toEqual(['arriving_soon']);

      h.clock.advanceMinutes(1);
      await sendPings(h, f, [inside(h, 0.5), inside(h, 0)]).expect(200);
      expect(await arrivedAt(id)).not.toBeNull();
      await evaluate();
      expect(await alerts()).toHaveLength(0);
    });
  });

  describe('access', () => {
    it('shows a fleet only its own alerts, to dispatchers only, and refuses a status that does not exist', async () => {
      await startTrip(h, f);
      h.clock.advanceMinutes(30);
      await evaluate();
      expect(await alerts()).toHaveLength(1);

      const other = await arrangeFleet(h);
      expect(await alerts('open', other.dispatcherToken)).toHaveLength(0);
      await h
        .api()
        .get('/v1/alerts')
        .set(...bearer(f.driverTokens[0] as string))
        .expect(403);
      await h
        .api()
        .get('/v1/alerts?status=bogus')
        .set(...bearer(f.dispatcherToken))
        .expect(400);
      void driverId();
    });
  });
});
