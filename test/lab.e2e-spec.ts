import { createServer, type Server } from 'node:http';
import { bearer, closeOwner, createHarness, type Harness, wipe } from './support/harness';

const DEMO_PASSWORD = 'Demo-password-0000';

describe('the lab', () => {
  describe('switched off (the default, and the only thing production can be)', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createHarness();
    });
    afterAll(async () => {
      await h.close();
    });

    it('does not exist: every lab route answers 404, as if it had never been written', async () => {
      await h.api().get('/api/lab/state').expect(404);
      await h.api().post('/api/lab/reset').expect(404);
      await h.api().post('/api/lab/session').send({ email: 'dispatcher@prairie.example.test' }).expect(404);
      await h.api().post('/api/lab/evaluate').expect(404);
      await h.api().get('/api/lab/field').expect(404);
    });
  });

  describe('switched on', () => {
    let h: Harness;
    let field: Server;
    let fieldUrl: string;
    const fieldCalls: { method?: string; url?: string; body: string }[] = [];

    beforeAll(async () => {
      field = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          fieldCalls.push({ method: req.method, url: req.url, body });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: req.url }));
        });
      });
      await new Promise<void>((resolve) => field.listen(0, '127.0.0.1', resolve));
      const address = field.address();
      fieldUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      h = await createHarness({ env: { LAB_MODE: 'true', DEMO_PASSWORD, FIELD_URL: fieldUrl } });
    });
    afterAll(async () => {
      await h.close();
      await new Promise((resolve) => field.close(resolve));
      await closeOwner();
    });
    beforeEach(async () => {
      await wipe(h);
      await h.api().post('/api/lab/reset').expect(200); // also tells the field to reset...
      fieldCalls.length = 0; // ...which is not what these tests are counting
    });

    it('describes itself: the demo accounts, the shared password and the thresholds in force', async () => {
      const state = (await h.api().get('/api/lab/state').expect(200)).body;
      expect(state.password).toBe(DEMO_PASSWORD);
      expect(state.accounts.map((a: { email: string }) => a.email)).toEqual(
        expect.arrayContaining([
          'dispatcher@prairie.example.test',
          'driver1@prairie.example.test',
          'dispatcher@harbor.example.test',
        ]),
      );
      expect(state.thresholds).toMatchObject({ no_signal_minutes: 15, arrival_confirmations: 2 });
      expect(state.router).toMatchObject({ configured: false });
    });

    it('seeds two fleets that cannot see each other, one with a unit of three places', async () => {
      const prairie = await h
        .api()
        .post('/api/lab/session')
        .send({ email: 'dispatcher@prairie.example.test' })
        .expect(200);
      const harbor = await h
        .api()
        .post('/api/lab/session')
        .send({ email: 'dispatcher@harbor.example.test' })
        .expect(200);
      const seen = async (token: string) =>
        (
          await h
            .api()
            .get('/v1/fleet/catalog')
            .set(...bearer(token))
            .expect(200)
        ).body;
      const a = await seen(prairie.body.access_token);
      const b = await seen(harbor.body.access_token);
      expect(a.drivers).toHaveLength(4);
      expect(b.drivers).toHaveLength(2);
      expect(a.units[0]).toMatchObject({ capacity: 3 });
      expect(a.places).toHaveLength(12);
      expect(JSON.stringify(a)).not.toContain(harbor.body.user.fleet_id);
    });

    it('signs in as a demo user without the password, and the token is an ordinary one', async () => {
      const session = (
        await h.api().post('/api/lab/session').send({ email: 'driver1@prairie.example.test' }).expect(200)
      ).body;
      expect(session).toMatchObject({ user: { role: 'driver' } });
      const trips = await h
        .api()
        .get('/v1/trips')
        .set(...bearer(session.access_token))
        .expect(200);
      expect(trips.body).toHaveLength(1); // the trip the seed planned for them
      await h
        .api()
        .get('/v1/fleet/snapshot')
        .set(...bearer(session.access_token))
        .expect(403); // a driver is still only a driver
    });

    it('refuses to mint a session for anything but a demo address, or for nobody', async () => {
      await h.api().post('/api/lab/session').send({ email: 'someone@example.com' }).expect(400);
      await h.api().post('/api/lab/session').send({ email: 'ghost@nowhere.example.test' }).expect(404);
      await h
        .api()
        .post('/api/lab/session')
        .send({ email: 'dispatcher@prairie.example.test', role: 'admin' })
        .expect(400);
    });

    it('runs the real evaluator and the real maintenance on demand', async () => {
      expect((await h.api().post('/api/lab/evaluate').expect(200)).body).toMatchObject({
        evaluated: 0,
        opened: 0,
        cleared: 0,
      });
      expect((await h.api().post('/api/lab/maintenance').expect(200)).body).toHaveProperty(
        'partitions_created',
      );
    });

    it('plans a fresh trip for a demo driver', async () => {
      const before = (
        await h
          .api()
          .get('/v1/trips')
          .set(
            ...bearer(
              (await h.api().post('/api/lab/session').send({ email: 'driver2@prairie.example.test' })).body
                .access_token,
            ),
          )
      ).body.length;
      const trip = (
        await h
          .api()
          .post('/api/lab/trips/replan')
          .send({ driver_email: 'driver2@prairie.example.test' })
          .expect(200)
      ).body;
      expect(trip).toMatchObject({ status: 'PLANNED' });
      expect(trip.origin_id).not.toBe(trip.destination_id);
      expect(before).toBe(1);
    });

    describe('only from its own page, on its own machine', () => {
      it('answers to localhost and loopback addresses', async () => {
        for (const host of ['localhost:8400', '127.0.0.1:8400', '[::1]:8400', 'LOCALHOST']) {
          await h.api().get('/api/lab/state').set('Host', host).expect(200);
        }
      });

      it('refuses any other Host with 421: a rebinding page cannot reach it under a name it controls', async () => {
        for (const host of ['evil.example', 'localhost.evil.example', '10.0.0.5:8400', 'lab.internal']) {
          const response = await h.api().get('/api/lab/state').set('Host', host).expect(421);
          expect(response.body.error.code).toBe('MISDIRECTED_REQUEST');
        }
      });

      it('refuses a state-changing request that comes from another website, and takes one from its own', async () => {
        const foreign = await h
          .api()
          .post('/api/lab/reset')
          .set('Origin', 'https://evil.example')
          .expect(403);
        expect(foreign.body.error.code).toBe('FOREIGN_ORIGIN');
        await h.api().post('/api/lab/reset').set('Origin', 'https://localhost.evil.example').expect(403);
        await h.api().post('/api/lab/reset').set('Origin', 'null').expect(403);
        await h.api().post('/api/lab/reset').set('Origin', 'http://localhost:8400').expect(200);
        await h.api().post('/api/lab/reset').set('Origin', 'http://127.0.0.1:8400').expect(200);
        await h.api().post('/api/lab/reset').expect(200); // no Origin at all: a command-line client
      });

      it('lets a foreign page READ nothing it should not: a foreign GET gets no CORS headers', async () => {
        const response = await h
          .api()
          .get('/api/lab/state')
          .set('Origin', 'https://evil.example')
          .expect(200);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      });
    });

    describe('the field stand-in', () => {
      it('forwards orders to the field, and only well-formed ones', async () => {
        await h
          .api()
          .post('/api/lab/field/phone')
          .send({ driver_email: 'driver1@prairie.example.test', mode: 'offline' })
          .expect(200);
        await h.api().post('/api/lab/field/router').send({ mode: 'down' }).expect(200);
        expect(fieldCalls.map((c) => `${c.method} ${c.url}`)).toEqual([
          'POST /control/phone',
          'POST /control/router',
        ]);
        expect(JSON.parse(fieldCalls[0]?.body ?? '{}')).toEqual({
          driver_email: 'driver1@prairie.example.test',
          mode: 'offline',
        });

        fieldCalls.length = 0;
        await h
          .api()
          .post('/api/lab/field/phone')
          .send({ driver_email: 'driver1@prairie.example.test', mode: 'rm -rf' })
          .expect(400);
        await h
          .api()
          .post('/api/lab/field/phone')
          .send({ driver_email: 'someone@mailbox.example.invalid', mode: 'offline' })
          .expect(400);
        await h
          .api()
          .post('/api/lab/field/phone')
          .send({ driver_email: 'driver1@prairie.example.test', mode: 'offline', url: 'http://elsewhere' })
          .expect(400);
        await h.api().post('/api/lab/field/router').send({ mode: 'melt' }).expect(400);
        expect(fieldCalls).toEqual([]);
      });

      it('reads the field’s state', async () => {
        expect((await h.api().get('/api/lab/field').expect(200)).body).toEqual({
          ok: true,
          path: '/control/state',
        });
      });

      it('says so plainly when the field cannot be reached', async () => {
        const lonely = await createHarness({
          env: { LAB_MODE: 'true', DEMO_PASSWORD, FIELD_URL: 'http://127.0.0.1:1' },
        });
        try {
          const response = await lonely.api().get('/api/lab/field').expect(502);
          expect(response.body.error.code).toBe('FIELD_UNAVAILABLE');
        } finally {
          await lonely.close();
        }
        const none = await createHarness({ env: { LAB_MODE: 'true', DEMO_PASSWORD } });
        try {
          await none.api().get('/api/lab/field').expect(503);
        } finally {
          await none.close();
        }
      });
    });
  });
});
