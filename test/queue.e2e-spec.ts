import {
  type Arranged,
  arrangeFleet,
  bearer,
  closeOwner,
  createHarness,
  type Harness,
} from './support/harness';

describe('capacity-aware queue', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
    await closeOwner();
  });

  let f: Arranged;
  let unit: string;
  beforeEach(async () => {
    f = await arrangeFleet(h, { unit: { name: 'Mobile Unit', capacity: 3 } });
    unit = f.unitId as string;
  });

  const as = (token: string) => ({
    post: (path: string, body: object = {}) =>
      h
        .api()
        .post(path)
        .set(...bearer(token))
        .send(body),
    get: (path: string) =>
      h
        .api()
        .get(path)
        .set(...bearer(token)),
  });
  const desk = () => as(f.dispatcherToken);

  const join = async (person: string, service = 'intake', priority = false, forUnit = unit) =>
    (await desk().post(`/v1/units/${forUnit}/tickets`, { person_ref: person, service, priority }).expect(200))
      .body as {
      ticket: { id: string; status: string };
      already_waiting: boolean;
    };
  const callNext = (count = 50, forUnit = unit) => desk().post(`/v1/units/${forUnit}/call-next`, { count });
  const board = async () => (await desk().get(`/v1/units/${unit}/board`).expect(200)).body;
  const peopleOnBoard = async (forUnit = unit): Promise<number> =>
    Number(
      (
        await h.owner.query(
          "SELECT count(DISTINCT person_ref) FROM tickets WHERE unit_id = $1 AND status IN ('called', 'serving')",
          [forUnit],
        )
      ).rows[0].count,
    );

  describe('joining', () => {
    it('is idempotent: the same person asking for the same service twice is one ticket', async () => {
      const first = await join('ana');
      const again = await join('ana');
      expect(first.already_waiting).toBe(false);
      expect(again.already_waiting).toBe(true);
      expect(again.ticket.id).toBe(first.ticket.id);
    });

    it('survives ten simultaneous joins of the same person', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          desk().post(`/v1/units/${unit}/tickets`, { person_ref: 'ana', service: 'intake' }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(new Set(results.map((r) => r.body.ticket.id)).size).toBe(1);
    });

    it('lets one person wait for different services at once', async () => {
      const a = await join('ana', 'intake');
      const b = await join('ana', 'pharmacy');
      expect(a.ticket.id).not.toBe(b.ticket.id);
    });

    it('refuses references and services that are not plain identifiers', async () => {
      await desk()
        .post(`/v1/units/${unit}/tickets`, { person_ref: 'ana; DROP TABLE tickets', service: 'intake' })
        .expect(400);
      await desk()
        .post(`/v1/units/${unit}/tickets`, { person_ref: 'ana', service: 'Intake Desk' })
        .expect(400);
      await desk()
        .post(`/v1/units/${unit}/tickets`, { person_ref: 'a'.repeat(65), service: 'intake' })
        .expect(400);
      await desk()
        .post(`/v1/units/${unit}/tickets`, { person_ref: 'ana', service: 'intake', extra: 1 })
        .expect(400);
    });
  });

  describe('calling', () => {
    it('calls people only up to the number of places, and says why it stopped', async () => {
      for (const p of ['a', 'b', 'c', 'd', 'e']) await join(p);
      const first = await callNext().expect(200);
      expect(first.body.called).toHaveLength(3);
      expect(first.body).toMatchObject({ onBoard: 0, capacity: 3, freeSlots: 3, reason: 'ok' });

      const second = await callNext().expect(200);
      expect(second.body.called).toHaveLength(0);
      expect(second.body).toMatchObject({ reason: 'full', onBoard: 3, freeSlots: 0 });
    });

    it('serves in arrival order, with priority first', async () => {
      await join('first');
      await join('second');
      await join('urgent', 'intake', true);
      const response = await callNext(2).expect(200);
      expect(response.body.called.map((t: { person_ref: string }) => t.person_ref)).toEqual([
        'urgent',
        'first',
      ]);
    });

    it('honours a smaller count than the places available', async () => {
      for (const p of ['a', 'b', 'c']) await join(p);
      const response = await callNext(1).expect(200);
      expect(response.body.called).toHaveLength(1);
    });

    it('frees a place when someone finishes', async () => {
      for (const p of ['a', 'b', 'c', 'd']) await join(p);
      const { body } = await callNext().expect(200);
      expect(body.called).toHaveLength(3);
      const id = body.called[0].id;
      await desk().post(`/v1/tickets/${id}/serve`).expect(200);
      await desk().post(`/v1/tickets/${id}/finish`).expect(200);
      const next = await callNext().expect(200);
      expect(next.body.called.map((t: { person_ref: string }) => t.person_ref)).toEqual(['d']);
    });

    it('lets someone already on board be called for a second service even when the unit is full', async () => {
      f = await arrangeFleet(h, { unit: { name: 'Small Unit', capacity: 2 } });
      unit = f.unitId as string;
      await join('ana', 'intake');
      await join('ana', 'pharmacy');
      await join('bo', 'intake');
      await join('cy', 'intake');

      const first = await callNext().expect(200);
      expect(first.body.called.map((t: { person_ref: string }) => t.person_ref).sort()).toEqual([
        'ana',
        'bo',
      ]);
      // full: two people on board. cy must wait -- but ana's pharmacy ticket costs no place.
      const second = await callNext().expect(200);
      expect(
        second.body.called.map(
          (t: { person_ref: string; service: string }) => `${t.person_ref}/${t.service}`,
        ),
      ).toEqual(['ana/pharmacy']);
      expect(await peopleOnBoard()).toBe(2);
    });

    it('applies the same ceiling to "call this one" as to "call the next"', async () => {
      for (const p of ['a', 'b', 'c']) await callNextSetup(p);
      const fourth = await join('d');
      const refused = await desk().post(`/v1/tickets/${fourth.ticket.id}/call`).expect(409);
      expect(refused.body.error).toMatchObject({ code: 'UNIT_FULL', details: { on_board: 3, capacity: 3 } });

      async function callNextSetup(person: string) {
        const t = await join(person);
        await desk().post(`/v1/tickets/${t.ticket.id}/call`).expect(200);
      }
    });

    it('never overshoots under pressure: ten dispatchers pressing "call next" at once fill three places, not thirty', async () => {
      for (let i = 0; i < 12; i += 1) await join(`p${i}`);
      const results = await Promise.all(Array.from({ length: 10 }, () => callNext(5)));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      const called = results.reduce((sum, r) => sum + (r.body.called as unknown[]).length, 0);
      expect(called).toBe(3);
      expect(await peopleOnBoard()).toBe(3);
    });

    it('never overshoots through the other door either: twelve simultaneous "call this one" admit exactly three', async () => {
      const tickets = [];
      for (let i = 0; i < 12; i += 1) tickets.push((await join(`q${i}`)).ticket.id);
      const results = await Promise.all(tickets.map((id) => desk().post(`/v1/tickets/${id}/call`)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(
        Array(9).fill('UNIT_FULL'),
      );
      expect(await peopleOnBoard()).toBe(3);
    });

    it('mixes both doors at once and still holds the line', async () => {
      const ids = [];
      for (let i = 0; i < 10; i += 1) ids.push((await join(`m${i}`)).ticket.id);
      await Promise.all([
        ...Array.from({ length: 5 }, () => callNext(3)),
        ...ids.slice(5).map((id) => desk().post(`/v1/tickets/${id}/call`)),
      ]);
      expect(await peopleOnBoard()).toBeLessThanOrEqual(3);
    });
  });

  describe('no ceiling configured', () => {
    it('calls everyone and says so, instead of quietly treating the missing limit as fine', async () => {
      f = await arrangeFleet(h, { unit: { name: 'Open Unit', capacity: null } });
      unit = f.unitId as string;
      for (const p of ['a', 'b', 'c', 'd', 'e']) await join(p);
      const response = await callNext().expect(200);
      expect(response.body.called).toHaveLength(5);
      expect(response.body.warning).toBe('no_capacity_configured');
      expect((await board()).warning).toBe('no_capacity_configured');
    });
  });

  describe('ticket life', () => {
    it('moves waiting -> called -> serving -> done, and refuses the moves that skip a step', async () => {
      const { ticket } = await join('ana');
      await desk().post(`/v1/tickets/${ticket.id}/serve`).expect(409); // not called yet
      await desk().post(`/v1/tickets/${ticket.id}/finish`).expect(409);
      await desk().post(`/v1/tickets/${ticket.id}/call`).expect(200);
      await desk().post(`/v1/tickets/${ticket.id}/call`).expect(409); // already called
      await desk().post(`/v1/tickets/${ticket.id}/serve`).expect(200);
      await desk().post(`/v1/tickets/${ticket.id}/cancel`).expect(409); // serving cannot be cancelled
      await desk().post(`/v1/tickets/${ticket.id}/finish`).expect(200);
      await desk().post(`/v1/tickets/${ticket.id}/finish`).expect(409);
    });

    it('lets someone leave the queue and rejoin it', async () => {
      const { ticket } = await join('ana');
      await desk().post(`/v1/tickets/${ticket.id}/cancel`).expect(200);
      const again = await join('ana');
      expect(again.already_waiting).toBe(false);
      expect(again.ticket.id).not.toBe(ticket.id);
    });

    it('shows the board: who is where, and how many places are free', async () => {
      for (const p of ['a', 'b', 'c', 'd']) await join(p);
      await callNext(2).expect(200);
      const b = await board();
      expect(b).toMatchObject({ on_board: 2, free_places: 1, unit: { capacity: 3 } });
      expect(b.tickets.map((t: { status: string }) => t.status).sort()).toEqual([
        'called',
        'called',
        'waiting',
        'waiting',
      ]);
    });
  });

  describe('isolation and input', () => {
    it('hides one fleet’s unit and tickets from another: every door answers "not found"', async () => {
      const { ticket } = await join('ana');
      const other = as((await arrangeFleet(h)).dispatcherToken);
      await other.get(`/v1/units/${unit}/board`).expect(404);
      await other.post(`/v1/units/${unit}/tickets`, { person_ref: 'x', service: 'intake' }).expect(404);
      await other.post(`/v1/units/${unit}/call-next`, { count: 1 }).expect(404);
      await other.post(`/v1/tickets/${ticket.id}/call`).expect(404);
      await other.post(`/v1/tickets/${ticket.id}/cancel`).expect(404);
    });

    it('keeps drivers out of the desk', async () => {
      await as(f.driverTokens[0] as string)
        .post(`/v1/units/${unit}/call-next`, { count: 1 })
        .expect(403);
    });

    it('validates new units: a ceiling of zero is not a ceiling, and a name is unique per fleet', async () => {
      await desk().post('/v1/units', { name: 'Zero', capacity: 0 }).expect(400);
      await desk().post('/v1/units', { name: 'Big', capacity: 10 }).expect(201);
      const duplicate = await desk().post('/v1/units', { name: 'Big', capacity: 10 }).expect(409);
      expect(duplicate.body.error.code).toBe('ALREADY_EXISTS');
    });

    it('refuses a call count outside 1..50', async () => {
      await callNext(0).expect(400);
      await callNext(51).expect(400);
    });
  });
});
