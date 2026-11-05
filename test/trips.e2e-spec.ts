import {
  type Arranged,
  arrangeFleet,
  bearer,
  closeOwner,
  createHarness,
  type Harness,
  planTrip,
  startTrip,
} from './support/harness';

describe('trip lifecycle', () => {
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
    f = await arrangeFleet(h);
  });

  const driver = (i = 0) => f.driverTokens[i] as string;
  const act = (id: string, action: string, token: string, body: object = {}) =>
    h
      .api()
      .post(`/v1/trips/${id}/${action}`)
      .set(...bearer(token))
      .send(body);

  it('walks PLANNED -> ACCEPTED -> IN_TRANSIT -> COMPLETED and stamps each step from the clock', async () => {
    const id = await planTrip(h, f);
    const accepted = await act(id, 'accept', driver()).expect(200);
    expect(accepted.body.status).toBe('ACCEPTED');
    h.clock.advanceMinutes(5);
    const started = await act(id, 'start', driver(), { km_start: 1000 }).expect(200);
    expect(started.body).toMatchObject({ status: 'IN_TRANSIT', km_start: 1000 });
    expect(new Date(started.body.started_at).getTime()).toBe(h.clock.now().getTime());
    h.clock.advanceMinutes(30);
    const done = await act(id, 'complete', driver(), { km_end: 1042 }).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', km_end: 1042 });
    expect(new Date(done.body.completed_at).getTime()).toBe(h.clock.now().getTime());
  });

  describe('who may do what', () => {
    it('lets only the dispatcher plan and cancel, and only the driver accept, start and complete', async () => {
      await h
        .api()
        .post('/v1/trips')
        .set(...bearer(driver()))
        .send({})
        .expect(403);
      const id = await planTrip(h, f);
      await act(id, 'accept', f.dispatcherToken).expect(403);
      await act(id, 'cancel', driver()).expect(403);
      await act(id, 'cancel', f.dispatcherToken).expect(200);
    });

    it('refuses moves the table does not allow, naming where the trip actually is', async () => {
      const id = await planTrip(h, f);
      const early = await act(id, 'start', driver(), { km_start: 10 }).expect(409);
      expect(early.body.error).toMatchObject({ code: 'INVALID_STATE', details: { current: 'PLANNED' } });
      await act(id, 'complete', driver(), { km_end: 20 }).expect(409);
      await act(id, 'accept', driver()).expect(200);
      await act(id, 'accept', driver()).expect(409); // twice
      await act(id, 'cancel', f.dispatcherToken).expect(200);
      await act(id, 'start', driver(), { km_start: 10 }).expect(409); // cancelled is final
    });

    it('does not let a driver touch a colleague’s trip: it reads as "not found", not "forbidden"', async () => {
      const id = await planTrip(h, f, 0);
      await act(id, 'accept', driver(1)).expect(404);
      await h
        .api()
        .get(`/v1/trips/${id}`)
        .set(...bearer(driver(1)))
        .expect(404);
    });
  });

  describe('races', () => {
    it('lets exactly one of ten simultaneous accepts win', async () => {
      const id = await planTrip(h, f);
      const results = await Promise.all(Array.from({ length: 10 }, () => act(id, 'accept', driver())));
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, ...Array(9).fill(409)]);
    });

    it('lets exactly one of ten simultaneous cancels win', async () => {
      const id = await planTrip(h, f);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => act(id, 'cancel', f.dispatcherToken)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('keeps every note when five are written at the same moment', async () => {
      const id = await startTrip(h, f);
      const writes = await Promise.all(
        Array.from({ length: 5 }, (_, i) => act(id, 'notes', driver(), { text: `note ${i}` })),
      );
      expect(writes.map((r) => r.status)).toEqual(Array(5).fill(200));
      const trip = await h
        .api()
        .get(`/v1/trips/${id}`)
        .set(...bearer(driver()))
        .expect(200);
      const lines = (trip.body.notes as string).split('\n');
      expect(lines).toHaveLength(5);
      expect(new Set(lines.map((l) => l.replace(/^\[[^\]]+\] /, '')))).toEqual(
        new Set(Array.from({ length: 5 }, (_, i) => `note ${i}`)),
      );
    });
  });

  describe('rules the database enforces', () => {
    it('refuses an end odometer that is not greater than the start, and takes the next valid one', async () => {
      const id = await startTrip(h, f);
      const same = await act(id, 'complete', driver(), { km_end: 1000 }).expect(422);
      expect(same.body.error).toMatchObject({ code: 'ODOMETER_BACKWARDS', details: { km_start: 1000 } });
      await act(id, 'complete', driver(), { km_end: 400 }).expect(422);
      await act(id, 'complete', driver(), { km_end: 1001 }).expect(200);
    });

    it('allows one active trip per driver', async () => {
      const first = await planTrip(h, f, 0, 'Harbor Yard', 'Elm Crossing');
      const second = await planTrip(h, f, 0, 'Stonegate', 'Ridgeway');
      await act(first, 'accept', driver()).expect(200);
      const blocked = await act(second, 'accept', driver()).expect(409);
      expect(blocked.body.error.code).toBe('ALREADY_ACTIVE');
      await act(first, 'start', driver(), { km_start: 5 }).expect(200);
      await act(first, 'complete', driver(), { km_end: 9 }).expect(200);
      await act(second, 'accept', driver()).expect(200); // the first is over: now it is allowed
    });

    it('allows one moving trip per vehicle, even when two drivers share it', async () => {
      await startTrip(h, f, 0);
      const shared = (f.drivers[0] as { vehicleId: string }).vehicleId;
      const response = await h
        .api()
        .post('/v1/trips')
        .set(...bearer(f.dispatcherToken))
        .send({
          vehicle_id: shared,
          driver_id: (f.drivers[1] as { id: string }).id,
          origin_id: f.places['Stonegate'],
          destination_id: f.places['Ridgeway'],
          planned_departure: h.clock.agoIso(0),
          expected_arrival: new Date(h.clock.now().getTime() + 3_600_000).toISOString(),
        })
        .expect(201);
      await act(response.body.id, 'accept', driver(1)).expect(200);
      const blocked = await act(response.body.id, 'start', driver(1), { km_start: 1 }).expect(409);
      expect(blocked.body.error.code).toBe('ALREADY_ACTIVE');
    });

    it('refuses a schedule that arrives before it leaves, and an origin equal to the destination', async () => {
      const driverRow = f.drivers[0] as { id: string; vehicleId: string };
      const base = {
        vehicle_id: driverRow.vehicleId,
        driver_id: driverRow.id,
        origin_id: f.places['Harbor Yard'],
        destination_id: f.places['Elm Crossing'],
      };
      const now = h.clock.now().getTime();
      const post = (over: object) =>
        h
          .api()
          .post('/v1/trips')
          .set(...bearer(f.dispatcherToken))
          .send({ ...base, ...over });
      const backwards = await post({
        planned_departure: new Date(now + 3_600_000).toISOString(),
        expected_arrival: new Date(now).toISOString(),
      }).expect(422);
      expect(backwards.body.error.code).toBe('INVALID_SCHEDULE');
      await post({
        destination_id: f.places['Harbor Yard'],
        planned_departure: new Date(now).toISOString(),
        expected_arrival: new Date(now + 3_600_000).toISOString(),
      }).expect(422);
    });
  });

  describe('visibility', () => {
    it('shows a driver their own trips and a dispatcher the whole fleet', async () => {
      await planTrip(h, f, 0);
      await planTrip(h, f, 1, 'Stonegate', 'Ridgeway');
      const mine = await h
        .api()
        .get('/v1/trips')
        .set(...bearer(driver(0)))
        .expect(200);
      const all = await h
        .api()
        .get('/v1/trips')
        .set(...bearer(f.dispatcherToken))
        .expect(200);
      expect(mine.body).toHaveLength(1);
      expect(all.body).toHaveLength(2);
    });

    it('filters by status, and refuses a status that does not exist', async () => {
      const id = await planTrip(h, f);
      await act(id, 'cancel', f.dispatcherToken).expect(200);
      const cancelled = await h
        .api()
        .get('/v1/trips?status=CANCELLED')
        .set(...bearer(f.dispatcherToken))
        .expect(200);
      expect(cancelled.body).toHaveLength(1);
      await h
        .api()
        .get('/v1/trips?status=PLANNED')
        .set(...bearer(f.dispatcherToken))
        .expect(200, []);
      await h
        .api()
        .get('/v1/trips?status=FLYING')
        .set(...bearer(f.dispatcherToken))
        .expect(400);
    });

    it('tells a driver where their trip goes -- and nothing about any other trip or place', async () => {
      const id = await planTrip(h, f, 0, 'Harbor Yard', 'Elm Crossing');
      const route = await h
        .api()
        .get(`/v1/trips/${id}/route`)
        .set(...bearer(driver(0)))
        .expect(200);
      expect(route.body).toMatchObject({
        trip_id: id,
        origin: { name: 'Harbor Yard', radius_m: 150 },
        destination: { name: 'Elm Crossing', radius_m: 150 },
      });
      expect(route.body.destination.lat).toBeCloseTo(38.445, 3);
      await h
        .api()
        .get(`/v1/trips/${id}/route`)
        .set(...bearer(driver(1)))
        .expect(404); // a colleague's trip
      const stranger = await arrangeFleet(h);
      await h
        .api()
        .get(`/v1/trips/${id}/route`)
        .set(...bearer(stranger.dispatcherToken))
        .expect(404); // another fleet's
    });

    it('answers a malformed id with 400, not with a database error', async () => {
      await h
        .api()
        .get('/v1/trips/not-a-uuid')
        .set(...bearer(f.dispatcherToken))
        .expect(400);
    });
  });
});
