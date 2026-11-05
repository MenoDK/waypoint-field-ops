import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import { ALL_EVENTS, EVENTS } from '../src/realtime/events';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { TOWNS } from '../src/standin/world';
import {
  type Arranged,
  arrangeFleet,
  bearer,
  closeOwner,
  createHarness,
  type Harness,
  ping,
  planTrip,
  sendPings,
  startTrip,
  wipe,
} from './support/harness';

interface Tap {
  socket: Socket;
  events: { name: string; data: Record<string, unknown> }[];
  of(name: string): Record<string, unknown>[];
  closed: () => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

describe('real-time delivery', () => {
  let h: Harness;
  const open: Socket[] = [];
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    for (const s of open) s.close();
    await h.close();
    await closeOwner();
  });

  /** Connects a socket with a token and records every application event it receives. */
  async function tap(token: string | undefined): Promise<Tap> {
    const socket = io(h.url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    open.push(socket);
    const events: Tap['events'] = [];
    for (const name of ALL_EVENTS)
      socket.on(name, (data: Record<string, unknown>) => events.push({ name, data }));
    let closed = false;
    socket.on('disconnect', () => (closed = true));
    await new Promise<void>((resolve) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', () => resolve());
    });
    // a connection is accepted before the server has authenticated it: give the handshake time to complete or be cut
    await sleep(150);
    return {
      socket,
      events,
      of: (name) => events.filter((e) => e.name === name).map((e) => e.data),
      closed: () => closed,
    };
  }

  let a: Arranged;
  let b: Arranged;
  beforeEach(async () => {
    await wipe(h);
    a = await arrangeFleet(h);
    b = await arrangeFleet(h);
  });

  it('shows a dispatcher their own fleet’s positions as they arrive, and nobody else’s', async () => {
    const dispatcherA = await tap(a.dispatcherToken);
    const dispatcherB = await tap(b.dispatcherToken);
    await sendPings(h, a, [ping(h, 0, { lat: 38.41 })]).expect(200);

    await until(() => dispatcherA.of(EVENTS.POSITION).length === 1, 3000, 'the position');
    expect(dispatcherA.of(EVENTS.POSITION)[0]).toMatchObject({
      driver_id: (a.drivers[0] as { id: string }).id,
      lat: 38.41,
    });
    await sleep(300);
    expect(dispatcherB.events).toEqual([]);
  });

  it('gives a driver only their own trip’s updates -- not the fleet’s positions', async () => {
    const driver = await tap(a.driverTokens[0] as string);
    const colleague = await tap(a.driverTokens[1] as string);
    const tripId = await planTrip(h, a, 0);
    await h
      .api()
      .post(`/v1/trips/${tripId}/accept`)
      .set(...bearer(a.driverTokens[0] as string))
      .expect(200);
    await sendPings(h, a, [ping(h, 0)]).expect(200);

    await until(() => driver.of(EVENTS.TRIP_UPDATED).length >= 2, 3000, 'the trip updates');
    await sleep(300);
    expect(driver.events.map((e) => e.name).every((n) => n === EVENTS.TRIP_UPDATED)).toBe(true);
    expect(colleague.events).toEqual([]);
  });

  describe('who may connect', () => {
    it('cuts a connection with no token, a bad token and a token of the wrong kind', async () => {
      const none = await tap(undefined);
      const bad = await tap('not-a-token');
      const forged = await tap(
        await new JwtService({ secret: 'z'.repeat(48) }).signAsync({
          sub: a.dispatcher.id,
          fid: a.fleetId,
          role: 'dispatcher',
        }),
      );
      for (const t of [none, bad, forged]) await until(() => t.closed(), 2000, 'the disconnect');
      await sendPings(h, a, [ping(h, 0)]).expect(200);
      await sleep(200);
      for (const t of [none, bad, forged]) expect(t.events).toEqual([]);
    });

    it('offers no way to ask for another fleet’s feed: there is nothing to subscribe to', async () => {
      const spy = await tap(a.dispatcherToken);
      for (const message of ['join', 'subscribe', 'room', 'joinRoom']) {
        spy.socket.emit(message, `fleet:${b.fleetId}`);
        spy.socket.emit(message, { room: `fleet:${b.fleetId}`, fleetId: b.fleetId });
      }
      await sendPings(h, b, [ping(h, 0)]).expect(200);
      await sleep(400);
      expect(spy.events).toEqual([]);
    });

    it('disconnects a client when its access token expires', async () => {
      const short = await h.app
        .get(JwtService)
        .signAsync({ sub: a.dispatcher.id, fid: a.fleetId, role: 'dispatcher' }, { expiresIn: 2 });
      const t = await tap(short);
      expect(t.closed()).toBe(false);
      await until(() => t.closed(), 4000, 'the token to expire');
    });
  });

  describe('one event per fact', () => {
    it('announces an arrival once, however many requests see it at the same moment', async () => {
      const dispatcher = await tap(a.dispatcherToken);
      await startTrip(h, a);
      h.clock.advanceMinutes(10);
      const dest = TOWNS.find((t) => t.name === 'Elm Crossing') as (typeof TOWNS)[number];
      const inside = (m: number) => ping(h, m, { lat: dest.lat, lng: dest.lng, speed_kmh: 3 });
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => sendPings(h, a, [inside(2 + i / 100), inside(1 + i / 100)])),
      );

      await until(() => dispatcherA(dispatcher).length >= 1, 3000, 'the arrival');
      await sleep(400);
      expect(dispatcherA(dispatcher)).toHaveLength(1);
      function dispatcherA(t: Tap) {
        return t.of(EVENTS.TRIP_ARRIVED);
      }
    });

    it('announces a transition once when ten requests race for it, and announces nothing for the ones that lose', async () => {
      const dispatcher = await tap(a.dispatcherToken);
      const id = await planTrip(h, a);
      await Promise.all(
        Array.from({ length: 10 }, () =>
          h
            .api()
            .post(`/v1/trips/${id}/accept`)
            .set(...bearer(a.driverTokens[0] as string)),
        ),
      );
      await until(
        () => dispatcher.of(EVENTS.TRIP_UPDATED).some((e) => e.status === 'ACCEPTED'),
        3000,
        'the acceptance',
      );
      await sleep(400);
      expect(dispatcher.of(EVENTS.TRIP_UPDATED).filter((e) => e.status === 'ACCEPTED')).toHaveLength(1);
    });

    it('announces an alert when it opens and when it clears, and not each time the evaluator looks', async () => {
      const dispatcher = await tap(a.dispatcherToken);
      await startTrip(h, a);
      h.clock.advanceMinutes(30);
      const alerts = h.app.get(AlertsService);
      await alerts.evaluate();
      await alerts.evaluate();
      await alerts.evaluate();
      await until(() => dispatcher.of(EVENTS.ALERT_OPENED).length === 1, 3000, 'the alert');
      await sleep(300);
      expect(dispatcher.of(EVENTS.ALERT_OPENED)).toHaveLength(1);

      await sendPings(h, a, [ping(h, 0)]).expect(200);
      await alerts.evaluate();
      await until(() => dispatcher.of(EVENTS.ALERT_CLEARED).length === 1, 3000, 'the clearing');
    });

    it('announces nothing for a change that was rolled back', async () => {
      const dispatcher = await tap(a.dispatcherToken);
      const tripId = await planTrip(h, a, 0, 'Harbor Yard', 'Elm Crossing');
      const second = await planTrip(h, a, 0, 'Stonegate', 'Ridgeway');
      await h
        .api()
        .post(`/v1/trips/${tripId}/accept`)
        .set(...bearer(a.driverTokens[0] as string))
        .expect(200);
      await until(
        () => dispatcher.of(EVENTS.TRIP_UPDATED).some((e) => e.status === 'ACCEPTED'),
        3000,
        'the first acceptance',
      );
      const before = dispatcher.of(EVENTS.TRIP_UPDATED).length;
      // the second acceptance violates "one active trip per driver": its transaction rolls back after the UPDATE attempt
      await h
        .api()
        .post(`/v1/trips/${second}/accept`)
        .set(...bearer(a.driverTokens[0] as string))
        .expect(409);
      await sleep(400);
      expect(dispatcher.of(EVENTS.TRIP_UPDATED)).toHaveLength(before);
    });

    it('tells the dispatcher’s desk when someone is called', async () => {
      const unit = await arrangeFleet(h, { unit: { name: 'Desk', capacity: 2 } });
      const dispatcher = await tap(unit.dispatcherToken);
      await h
        .api()
        .post(`/v1/units/${unit.unitId}/tickets`)
        .set(...bearer(unit.dispatcherToken))
        .send({ person_ref: 'ana', service: 'intake' })
        .expect(200);
      await h
        .api()
        .post(`/v1/units/${unit.unitId}/call-next`)
        .set(...bearer(unit.dispatcherToken))
        .send({ count: 1 })
        .expect(200);
      await until(() => dispatcher.of(EVENTS.TICKET_CALLED).length === 1, 3000, 'the call');
      expect(dispatcher.of(EVENTS.TICKET_CALLED)[0]).toMatchObject({ person_ref: 'ana', service: 'intake' });
      expect(dispatcher.of(EVENTS.QUEUE_UPDATED).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('when the listening connection dies', () => {
    it('reconnects by itself on a new connection, is ready again, and resumes delivering', async () => {
      const dispatcher = await tap(a.dispatcherToken);
      const ready = async () => (await h.api().get('/health/ready')).body;
      expect((await ready()).checks.realtime).toBe('up');

      const listeners = async (): Promise<number[]> =>
        (
          await h.owner.query(
            "SELECT pid FROM pg_stat_activity WHERE usename = 'app_user' AND query LIKE 'LISTEN waypoint_events%'",
          )
        ).rows.map((r: { pid: number }) => r.pid);
      const before = await listeners();
      expect(before).toHaveLength(1);
      await h.owner.query('SELECT pg_terminate_backend($1)', [before[0]]);

      // it has to notice, wait a moment and open a NEW connection: a different backend is listening afterwards
      let after: number[] = [];
      for (let i = 0; i < 80 && (after.length !== 1 || after[0] === before[0]); i += 1) {
        await sleep(100);
        after = await listeners();
      }
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(before[0]);
      expect((await ready()).checks.realtime).toBe('up');

      await sendPings(h, a, [ping(h, 0, { lat: 38.43 })]).expect(200);
      await until(() => dispatcher.of(EVENTS.POSITION).length === 1, 3000, 'a position after the reconnect');
    });
  });
});
