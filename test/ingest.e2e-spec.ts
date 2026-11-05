import {
  type Arranged,
  arrangeFleet,
  bearer,
  closeOwner,
  createHarness,
  type Harness,
  ping,
  sendPings,
  startTrip,
} from './support/harness';

describe('ping ingest', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
    await closeOwner();
  });

  const count = async (driverId: string): Promise<number> =>
    Number(
      (await h.owner.query('SELECT count(*) FROM pings WHERE driver_id = $1', [driverId])).rows[0].count,
    );
  const livePin = async (driverId: string) =>
    (
      await h.owner.query(
        'SELECT ST_Y(geom::geometry) AS lat, captured_at FROM vehicle_positions WHERE driver_id = $1',
        [driverId],
      )
    ).rows[0] as { lat: number; captured_at: Date } | undefined;

  describe('who may send', () => {
    it('refuses a request with no token', async () => {
      await h.api().post('/v1/pings').send({ pings: [] }).expect(401);
    });

    it('refuses a dispatcher: only a driver reports a position', async () => {
      const f = await arrangeFleet(h);
      await h
        .api()
        .post('/v1/pings')
        .set(...bearer(f.dispatcherToken))
        .send({ pings: [ping(h, 1)] })
        .expect(403);
    });

    it('refuses a body that names a driver: identity comes from the token, never from the body', async () => {
      const f = await arrangeFleet(h);
      const response = await h
        .api()
        .post('/v1/pings')
        .set(...bearer(f.driverTokens[0] as string))
        .send({ pings: [{ ...ping(h, 1), driver_id: (f.drivers[1] as { id: string }).id }] });
      expect(response.status).toBe(400);
      expect(await count((f.drivers[1] as { id: string }).id)).toBe(0);
    });
  });

  describe('storing', () => {
    let f: Arranged;
    beforeEach(async () => {
      f = await arrangeFleet(h);
    });
    const me = () => (f.drivers[0] as { id: string }).id;

    it('stores a reading and moves the live pin', async () => {
      const response = await sendPings(h, f, [ping(h, 1, { lat: 38.41 })]).expect(200);
      expect(response.body).toMatchObject({
        accepted: 1,
        duplicates: 0,
        rejected: [],
        position_updated: true,
      });
      expect(await count(me())).toBe(1);
      expect((await livePin(me()))?.lat).toBeCloseTo(38.41, 5);
    });

    it('is idempotent: replaying a batch stores nothing new and says so', async () => {
      const batch = [ping(h, 3), ping(h, 2), ping(h, 1)];
      await sendPings(h, f, batch).expect(200);
      const again = await sendPings(h, f, batch).expect(200);
      expect(again.body).toMatchObject({ accepted: 0, duplicates: 3, position_updated: false });
      expect(await count(me())).toBe(3);
    });

    it('survives twenty identical batches arriving at once, in any order', async () => {
      const batch = Array.from({ length: 30 }, (_, i) => ping(h, 60 - i));
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => sendPings(h, f, i % 2 ? [...batch].reverse() : batch)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
      const accepted = results.reduce((sum, r) => sum + (r.body as { accepted: number }).accepted, 0);
      expect(accepted).toBe(30); // exactly one request won each reading
      expect(await count(me())).toBe(30);
    });

    it('keeps the good readings of a batch and lists the bad ones', async () => {
      const response = await sendPings(h, f, [
        ping(h, 5),
        ping(h, 4, { lat: 0, lng: 0 }), // "no fix": the Null Island reading
        ping(h, -30), // 30 minutes in the future: a wrong clock
        ping(h, 60 * 24 * 40), // older than retention
        ping(h, 3),
      ]).expect(200);
      expect(response.body).toMatchObject({
        accepted: 2,
        rejected: [
          { index: 1, reason: 'bad_coordinate' },
          { index: 2, reason: 'future' },
          { index: 3, reason: 'too_old' },
        ],
      });
      expect(await count(me())).toBe(2);
    });

    it('refuses a whole request that is not a list of readings, or is too large', async () => {
      await sendPings(h, f, 'nope' as never).expect(400);
      await sendPings(h, f, []).expect(400);
      await sendPings(
        h,
        f,
        Array.from({ length: h.env.PING_MAX_BATCH + 1 }, (_, i) => ping(h, 1, { lat: 38 + i / 1e6 })),
      ).expect(400);
    });

    it('does not let a batch of OLD readings drag the pin backwards', async () => {
      await sendPings(h, f, [ping(h, 1, { lat: 38.45 })]).expect(200);
      const late = await sendPings(h, f, [ping(h, 30, { lat: 38.1 }), ping(h, 29, { lat: 38.11 })]).expect(
        200,
      );
      expect(late.body).toMatchObject({ accepted: 2, position_updated: false });
      expect((await livePin(me()))?.lat).toBeCloseTo(38.45, 5);
      expect(await count(me())).toBe(3); // ...but the history keeps them
    });

    it('moves the pin to the newest reading of a batch even when it is not last in the list', async () => {
      await sendPings(h, f, [ping(h, 1, { lat: 38.5 }), ping(h, 9, { lat: 38.2 })]).expect(200);
      expect((await livePin(me()))?.lat).toBeCloseTo(38.5, 5);
    });
  });

  describe('which trip a reading belongs to', () => {
    it('is the trip that covered the moment of capture, not the one running on arrival', async () => {
      const f = await arrangeFleet(h);
      const driverId = (f.drivers[0] as { id: string }).id;
      const token = f.driverTokens[0] as string;

      await sendPings(h, f, [ping(h, 2)]).expect(200); // two minutes BEFORE the trip starts: belongs to none
      const tripId = await startTrip(h, f);
      h.clock.advanceMinutes(10);
      await h
        .api()
        .post(`/v1/trips/${tripId}/complete`)
        .set(...bearer(token))
        .send({ km_end: 1060 })
        .expect(200);
      h.clock.advanceMinutes(5);

      // The phone was in a tunnel: it uploads now, after the trip is over, readings taken 3 and 8 minutes into it and one after.
      await sendPings(h, f, [ping(h, 12), ping(h, 7), ping(h, 1)]).expect(200);

      const { rows } = await h.owner.query(
        'SELECT captured_at, trip_id FROM pings WHERE driver_id = $1 ORDER BY captured_at',
        [driverId],
      );
      expect(rows.map((r: { trip_id: string | null }) => r.trip_id)).toEqual([null, tripId, tripId, null]);
    });
  });
});
