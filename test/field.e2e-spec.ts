import { Field, controlServer } from '../src/standin/field';
import type { Server } from 'node:http';
import { closeOwner, createHarness, type Harness, LiveClock, wipe } from './support/harness';

const DEMO_PASSWORD = 'Demo-password-0000';
const DRIVER = 'driver1@prairie.example.test';

describe('the simulated field', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({
      clock: new LiveClock(),
      env: { LAB_MODE: 'true', DEMO_PASSWORD, AUTH_ACCOUNT_LIMIT: '1000' },
    });
  });
  afterAll(async () => {
    await h.close();
    await closeOwner();
  });

  let field: Field;
  beforeEach(async () => {
    await wipe(h);
    await h.api().post('/api/lab/reset').expect(200);
    field = new Field({
      apiUrl: h.url,
      password: DEMO_PASSWORD,
      drivers: [DRIVER],
      // 100x: a ten-minute drive takes about six seconds. Ticks are driven by hand, so the test is deterministic about order.
      phone: { tickMs: 15, reportEvery: 2, timeScale: 100, dwellTicks: 6, replanAfterTicks: 3 },
    });
  });
  afterEach(async () => {
    await field.stop();
  });

  const driverRow = async () =>
    (await h.owner.query('SELECT id, vehicle_id FROM users WHERE email = $1', [DRIVER])).rows[0] as {
      id: string;
      vehicle_id: string;
    };
  const trips = async () =>
    (
      await h.owner.query(
        'SELECT id, status, arrived_at, km_start, km_end FROM trips WHERE driver_id = $1 ORDER BY planned_departure, created_at',
        [(await driverRow()).id],
      )
    ).rows as {
      id: string;
      status: string;
      arrived_at: Date | null;
      km_start: number | null;
      km_end: number | null;
    }[];
  const pingCount = async () =>
    Number(
      (await h.owner.query('SELECT count(*) FROM pings WHERE driver_id = $1', [(await driverRow()).id]))
        .rows[0].count,
    );

  /** Ticks the field until `done` is true (or fails after `max` ticks). */
  async function run(done: () => Promise<boolean>, max = 1500): Promise<number> {
    for (let i = 0; i < max; i += 1) {
      await field.tick();
      if (i % 5 === 0 && (await done())) return i;
    }
    throw new Error(`not done after ${max} ticks: ${JSON.stringify(field.state().phones[0])}`);
  }
  const phone = () => field.state().phones[0] as ReturnType<Field['state']>['phones'][number];

  it('drives a whole trip through the public API: accept, start, report, arrive, complete -- and then gets another', async () => {
    await run(async () => (await trips()).some((t) => t.status === 'COMPLETED'));
    const [done] = (await trips()).filter((t) => t.status === 'COMPLETED');
    expect(done?.arrived_at).not.toBeNull(); // the server DECIDED it had arrived, from the readings
    expect(done?.km_end).toBeGreaterThan(done?.km_start as number);

    const attributed = await h.owner.query('SELECT count(*) FROM pings WHERE trip_id = $1', [done?.id]);
    expect(Number(attributed.rows[0].count)).toBeGreaterThan(20);
    expect(phone().stats.rejected).toEqual({});

    // idle for a few ticks, its dispatcher plans the next trip, and it sets off again
    await run(async () => (await trips()).length >= 2);
    await run(async () => (await trips()).some((t) => t.status === 'IN_TRANSIT' && t.id !== done?.id));
  });

  it('holds a backlog while offline and uploads it in one go when the connection returns, without duplicates', async () => {
    await run(async () => phone().trip?.status === 'IN_TRANSIT');
    field.setPhone(DRIVER, 'offline');
    const stored = await pingCount();
    for (let i = 0; i < 40; i += 1) await field.tick();
    expect(phone().buffered).toBeGreaterThanOrEqual(15);
    expect(await pingCount()).toBe(stored); // nothing reached the server while the phone had no connection

    const backlog = phone().buffered;
    field.setPhone(DRIVER, 'online');
    await run(async () => phone().buffered === 0);
    expect(await pingCount()).toBeGreaterThanOrEqual(stored + backlog);
    expect(phone().stats.duplicates).toBe(0);
    expect(phone().stats.rejected).toEqual({});
  });

  it('is told off by the server for a wrong clock: those readings are rejected, not believed', async () => {
    await run(async () => phone().trip?.status === 'IN_TRANSIT');
    field.setPhone(DRIVER, 'bad_clock');
    const before = await pingCount();
    for (let i = 0; i < 20; i += 1) await field.tick();
    expect(phone().stats.rejected.future).toBeGreaterThanOrEqual(8);
    expect(await pingCount()).toBe(before);
    field.setPhone(DRIVER, 'drive');
    for (let i = 0; i < 10; i += 1) await field.tick();
    expect(await pingCount()).toBeGreaterThan(before); // back to normal: readings are accepted again
  });

  it('goes quiet when its battery dies, and carries on when it is revived', async () => {
    await run(async () => phone().trip?.status === 'IN_TRANSIT');
    field.setPhone(DRIVER, 'dead');
    const before = await pingCount();
    for (let i = 0; i < 20; i += 1) await field.tick();
    expect(await pingCount()).toBe(before);
    field.setPhone(DRIVER, 'resume');
    for (let i = 0; i < 10; i += 1) await field.tick();
    expect(await pingCount()).toBeGreaterThan(before);
  });

  it('can park the truck, which the server sees as a stop', async () => {
    await run(async () => phone().trip?.status === 'IN_TRANSIT');
    field.setPhone(DRIVER, 'stopped');
    for (let i = 0; i < 6; i += 1) await field.tick();
    const speeds = await h.owner.query(
      'SELECT speed_kmh FROM pings WHERE driver_id = $1 ORDER BY captured_at DESC LIMIT 2',
      [(await driverRow()).id],
    );
    expect(speeds.rows.map((r: { speed_kmh: number }) => r.speed_kmh)).toEqual([0, 0]);
  });

  it('hovering at the edge of the destination is not arriving: it takes consecutive readings inside the radius', async () => {
    await run(async () => phone().trip?.status === 'IN_TRANSIT');
    field.setPhone(DRIVER, 'jitter');
    field.setPhone(DRIVER, 'teleport');
    for (let i = 0; i < 80; i += 1) await field.tick();
    const [trip] = (await trips()).filter((t) => t.status === 'IN_TRANSIT');
    expect(trip?.arrived_at).toBeNull(); // inside, outside, inside, outside... never two in a row

    field.setPhone(DRIVER, 'drive');
    await run(async () => (await trips()).some((t) => t.arrived_at !== null));
  });

  describe('the control switchboard', () => {
    let server: Server;
    let base: string;
    beforeEach(async () => {
      server = controlServer(field);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    });
    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('reports state and takes orders', async () => {
      expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok' });
      const state = (await (await fetch(`${base}/control/state`)).json()) as ReturnType<Field['state']>;
      expect(state.phones.map((p) => p.email)).toEqual([DRIVER]);
      expect((await post('/control/phone', { driver_email: DRIVER, mode: 'offline' })).status).toBe(200);
      expect(phone().mode).toContain('offline');
      expect((await post('/control/router', { mode: 'down' })).status).toBe(200);
      expect(field.router.mode).toBe('down');
    });

    it('refuses everything it was not built to do', async () => {
      expect((await post('/control/phone', { driver_email: DRIVER, mode: 'explode' })).status).toBe(400);
      expect((await post('/control/phone', { driver_email: DRIVER, mode: 'offline', extra: 1 })).status).toBe(
        400,
      );
      expect(
        (await post('/control/phone', { driver_email: 'nobody@x.example.test', mode: 'offline' })).status,
      ).toBe(404);
      expect((await post('/control/router', { mode: 'melt' })).status).toBe(400);
      expect((await post('/control/shell', { cmd: 'ls' })).status).toBe(404);
      expect((await fetch(`${base}/control/state`, { method: 'DELETE' })).status).toBe(404);
      const oversized = await fetch(`${base}/control/phone`, { method: 'POST', body: 'x'.repeat(10_000) });
      expect(oversized.status).toBe(400);
    });

    it('resets the phones and the router together', async () => {
      await run(async () => phone().trip?.status === 'IN_TRANSIT');
      field.router.mode = 'down';
      expect((await post('/control/reset', {})).status).toBe(200);
      expect(phone()).toMatchObject({ signed_in: false, trip: null, buffered: 0 });
      expect(field.router.mode).toBe('ok');
    });
  });
});
