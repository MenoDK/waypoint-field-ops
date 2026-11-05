import { JwtService } from '@nestjs/jwt';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { IS_PUBLIC, ROLES_KEY } from '../src/common/auth';
import {
  type Arranged,
  arrangeFleet,
  bearer,
  closeOwner,
  createHarness,
  type Harness,
  PASSWORD,
  planTrip,
  startTrip,
} from './support/harness';

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('security', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
    await closeOwner();
  });

  describe('signing in', () => {
    let f: Arranged;
    beforeEach(async () => {
      f = await arrangeFleet(h);
    });
    const login = (email: string, password: string) =>
      h.api().post('/v1/auth/login').send({ email, password });

    it('gives a token and the user for the right password', async () => {
      const response = await login(f.dispatcher.email, PASSWORD).expect(200);
      expect(response.body).toMatchObject({ user: { role: 'dispatcher', fleet_id: f.fleetId } });
      await h
        .api()
        .get('/v1/me')
        .set(...bearer(response.body.access_token))
        .expect(200);
    });

    it('answers a wrong password and an unknown account in exactly the same words', async () => {
      const wrong = await login(f.dispatcher.email, 'not-the-password').expect(401);
      const unknown = await login('nobody@nowhere.example.test', 'not-the-password').expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.error.code).toBe(wrong.body.error.code);
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('slows guessing: after ten failures on one account the eleventh is refused, even with the right password', async () => {
      const victim = f.drivers[0] as { email: string };
      for (let i = 0; i < 10; i += 1) await login(victim.email, `guess-${i}`).expect(401);
      const blocked = await login(victim.email, PASSWORD).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('refuses extra fields and malformed bodies', async () => {
      await h
        .api()
        .post('/v1/auth/login')
        .send({ email: f.dispatcher.email, password: PASSWORD, role: 'dispatcher' })
        .expect(400);
      await h.api().post('/v1/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
      await h.api().post('/v1/auth/login').send('nope').expect(400);
    });
  });

  describe('tokens', () => {
    let f: Arranged;
    beforeEach(async () => {
      f = await arrangeFleet(h);
    });
    const claims = () => ({ sub: f.dispatcher.id, fid: f.fleetId, role: 'dispatcher' });
    const refused = (token: string) =>
      h
        .api()
        .get('/v1/me')
        .set(...bearer(token))
        .expect(401);

    it('refuses a request with no token, a malformed header and the wrong scheme', async () => {
      await h.api().get('/v1/me').expect(401);
      await h.api().get('/v1/me').set('Authorization', 'Bearer').expect(401);
      await h.api().get('/v1/me').set('Authorization', `Basic ${f.dispatcherToken}`).expect(401);
      await h.api().get('/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('refuses an unsigned token ("alg": "none")', async () => {
      await refused(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims())}.`);
    });

    it('refuses a token signed with some other key', async () => {
      await refused(await new JwtService({ secret: 'k'.repeat(48) }).signAsync(claims()));
    });

    it('refuses an expired token', async () => {
      await refused(await h.app.get(JwtService).signAsync(claims(), { expiresIn: -30 }));
    });

    it('refuses a correctly signed token whose claims make no sense', async () => {
      const jwt = h.app.get(JwtService);
      await refused(await jwt.signAsync({ ...claims(), role: 'admin' }));
      await refused(await jwt.signAsync({ ...claims(), sub: 'not-a-uuid' }));
      await refused(await jwt.signAsync({ sub: f.dispatcher.id }));
    });

    it('trusts the fleet in the token, not one named in a request', async () => {
      const other = await arrangeFleet(h);
      // a body that names the other fleet is not even a valid body
      await h
        .api()
        .post('/v1/units')
        .set(...bearer(f.dispatcherToken))
        .send({ name: 'Sneaky', capacity: 2, fleet_id: other.fleetId })
        .expect(400);
    });
  });

  describe('one fleet cannot reach another', () => {
    let a: Arranged;
    let b: Arranged;
    let tripId: string;
    beforeEach(async () => {
      a = await arrangeFleet(h);
      b = await arrangeFleet(h);
      tripId = await startTrip(h, a);
    });
    const asB = () => bearer(b.dispatcherToken);

    it('answers "not found" -- never "forbidden" -- to every read and write on a trip of the other fleet', async () => {
      await h
        .api()
        .get(`/v1/trips/${tripId}`)
        .set(...asB())
        .expect(404);
      await h
        .api()
        .get(`/v1/trips/${tripId}/trail`)
        .set(...asB())
        .expect(404);
      await h
        .api()
        .post(`/v1/trips/${tripId}/sheet-link`)
        .set(...asB())
        .expect(404);
      await h
        .api()
        .post(`/v1/trips/${tripId}/cancel`)
        .set(...asB())
        .expect(404);
      await h
        .api()
        .post(`/v1/trips/${tripId}/complete`)
        .set(...bearer(b.driverTokens[0] as string))
        .send({ km_end: 5000 })
        .expect(404);
      await h
        .api()
        .post(`/v1/trips/${tripId}/notes`)
        .set(...bearer(b.driverTokens[0] as string))
        .send({ text: 'hi' })
        .expect(404);
    });

    it('does not list the other fleet’s trips, drivers or places', async () => {
      expect(
        (
          await h
            .api()
            .get('/v1/trips')
            .set(...asB())
            .expect(200)
        ).body,
      ).toHaveLength(0);
      const catalog = (
        await h
          .api()
          .get('/v1/fleet/catalog')
          .set(...asB())
          .expect(200)
      ).body;
      const ids = JSON.stringify(catalog);
      expect(ids).not.toContain(a.fleetId);
      for (const d of a.drivers) expect(ids).not.toContain(d.id);
      const snapshot = (
        await h
          .api()
          .get('/v1/fleet/snapshot')
          .set(...asB())
          .expect(200)
      ).body;
      expect(snapshot.vehicles.map((v: { driver_id: string }) => v.driver_id).sort()).toEqual(
        b.drivers.map((d) => d.id).sort(),
      );
    });

    it('refuses to plan a trip with the other fleet’s driver, vehicle or place, and creates nothing', async () => {
      const mine = b.drivers[0] as { id: string; vehicleId: string };
      const base = {
        vehicle_id: mine.vehicleId,
        driver_id: mine.id,
        origin_id: b.places['Harbor Yard'],
        destination_id: b.places['Elm Crossing'],
        planned_departure: h.clock.agoIso(0),
        expected_arrival: new Date(h.clock.now().getTime() + 3_600_000).toISOString(),
      };
      const post = (over: object) =>
        h
          .api()
          .post('/v1/trips')
          .set(...asB())
          .send({ ...base, ...over });
      expect(
        (await post({ driver_id: (a.drivers[0] as { id: string }).id }).expect(422)).body.error.code,
      ).toBe('NOT_A_DRIVER');
      expect(
        (await post({ vehicle_id: (a.drivers[0] as { vehicleId: string }).vehicleId }).expect(409)).body.error
          .code,
      ).toBe('REFERENCE_VIOLATION');
      await post({ origin_id: a.places['Harbor Yard'] }).expect(409);
      await post({ fleet_id: a.fleetId }).expect(400);
      const count = await h.owner.query('SELECT count(*) FROM trips WHERE fleet_id = $1', [b.fleetId]);
      expect(count.rows[0].count).toBe('0');
    });

    it('keeps a driver to their own trips even inside their own fleet', async () => {
      const second = await planTrip(h, a, 1, 'Stonegate', 'Ridgeway');
      await h
        .api()
        .get(`/v1/trips/${second}`)
        .set(...bearer(a.driverTokens[0] as string))
        .expect(404);
    });
  });

  describe('the signed trip-sheet link', () => {
    let f: Arranged;
    let tripId: string;
    let link: string;
    beforeEach(async () => {
      f = await arrangeFleet(h);
      tripId = await startTrip(h, f);
      link = (
        await h
          .api()
          .post(`/v1/trips/${tripId}/sheet-link`)
          .set(...bearer(f.dispatcherToken))
          .expect(200)
      ).body.url;
    });
    const query = (url: string) => new URL(url, 'http://x').searchParams;

    it('opens without a token and returns a PDF', async () => {
      const response = await h
        .api()
        .get(link)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['cache-control']).toContain('no-store');
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('cannot be bent: another trip, a longer expiry, a damaged or missing signature', async () => {
      const q = query(link);
      const exp = q.get('exp') as string;
      const sig = q.get('sig') as string;
      const other = await startTrip(h, f, 1, 'Stonegate', 'Ridgeway');
      const get = (id: string, e: string | undefined, s: string | undefined) =>
        h
          .api()
          .get(`/v1/trips/${id}/sheet.pdf`)
          .query({ ...(e ? { exp: e } : {}), ...(s ? { sig: s } : {}) });

      expect((await get(other, exp, sig).expect(403)).body.error.code).toBe('INVALID_LINK'); // same signature, other trip
      await get(tripId, String(Number(exp) + 3600), sig).expect(403); // extended expiry
      await get(tripId, exp, `${sig.startsWith('A') ? 'B' : 'A'}${sig.slice(1)}`).expect(403); // a damaged first character
      await get(tripId, exp, 'x').expect(403);
      await get(tripId, undefined, undefined).expect(403);
      await get(tripId, exp, undefined).expect(403);
    });

    it('does not reveal whether a trip exists: an unknown trip reads like a bad signature', async () => {
      const q = query(link);
      const unknown = '00000000-0000-4000-8000-000000000000';
      const response = await h
        .api()
        .get(`/v1/trips/${unknown}/sheet.pdf`)
        .query({ exp: q.get('exp'), sig: q.get('sig') })
        .expect(403);
      expect(response.body.error.code).toBe('INVALID_LINK');
    });

    it('expires -- and a forged link that is also expired reads as forged, not as expired', async () => {
      const q = query(link);
      const exp = q.get('exp') as string;
      const sig = q.get('sig') as string;
      h.clock.advanceSeconds(h.env.SIGNED_URL_TTL_SECONDS + 5);
      expect((await h.api().get(link).expect(410)).body.error.code).toBe('LINK_EXPIRED');
      const forged = await h
        .api()
        .get(`/v1/trips/${tripId}/sheet.pdf`)
        .query({ exp: String(Number(exp) - 1000), sig })
        .expect(403);
      expect(forged.body.error.code).toBe('INVALID_LINK');
    });

    it('is only handed out to the fleet that owns the trip', async () => {
      const stranger = await arrangeFleet(h);
      await h
        .api()
        .post(`/v1/trips/${tripId}/sheet-link`)
        .set(...bearer(stranger.dispatcherToken))
        .expect(404);
      await h
        .api()
        .post(`/v1/trips/${tripId}/sheet-link`)
        .set(...bearer(f.driverTokens[0] as string))
        .expect(403);
    });
  });

  describe('what the database lets the application do', () => {
    let app: Pool;
    beforeAll(() => {
      app = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    });
    afterAll(async () => {
      await app.end();
    });
    const code = async (sql: string): Promise<string | undefined> =>
      app.query(sql).then(
        () => undefined,
        (error: { code?: string }) => error.code,
      );

    it('cannot rewrite or delete history: pings are append-only for the application role', async () => {
      expect(await code('DELETE FROM pings')).toBe('42501');
      expect(await code('UPDATE pings SET accuracy_m = 0 WHERE false')).toBe('42501');
      expect(await code('TRUNCATE pings')).toBe('42501');
    });

    it('cannot change the schema', async () => {
      expect(await code('DROP TABLE pings')).toBe('42501'); // not the owner
      expect(await code('CREATE TABLE sneaky (id int)')).toBe('42501');
      expect(await code('ALTER TABLE users ADD COLUMN sneaky int')).toBe('42501');
      expect(await code('DROP TABLE schema_migrations')).toBe('42501');
    });

    it('cannot touch the migration ledger', async () => {
      expect(await code('SELECT * FROM schema_migrations')).toBe('42501');
    });

    it('can still do its job, and retire old data only through the narrow function', async () => {
      expect(await code("SELECT drop_ping_partitions_before('2000-01-01')")).toBeUndefined();
      expect(await code('SELECT ensure_ping_partitions(0, 1)')).toBeUndefined();
    });
  });

  describe('every route declares who may call it', () => {
    it('has @Public or @Roles on every handler, and finds enough routes for the check to mean something', () => {
      const reflector = h.app.get(Reflector);
      const routes: string[] = [];
      const missing: string[] = [];
      for (const module of h.app.get(ModulesContainer).values()) {
        for (const wrapper of module.controllers.values()) {
          const type = wrapper.metatype as (new (...args: never[]) => object) | null;
          if (!type) continue;
          for (const name of Object.getOwnPropertyNames(type.prototype)) {
            if (name === 'constructor') continue; // the class itself carries the controller's path metadata
            const handler = (type.prototype as Record<string, unknown>)[name];
            if (typeof handler !== 'function' || Reflect.getMetadata('path', handler) === undefined) continue;
            routes.push(`${type.name}.${name}`);
            const targets = [handler, type];
            const open = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
            const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
            if (!open && !roles?.length) missing.push(`${type.name}.${name}`);
          }
        }
      }
      expect(routes.length).toBeGreaterThan(35);
      expect(missing).toEqual([]);
    });
  });

  describe('what the server says about itself', () => {
    it('sends the security headers, and does not announce its framework', async () => {
      const response = await h.api().get('/health/live').expect(200);
      const csp = response.headers['content-security-policy'] as string;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('answers an unknown route with the standard envelope and nothing about the framework', async () => {
      const response = await h
        .api()
        .get('/v1/nothing-here')
        .set(...bearer((await arrangeFleet(h)).dispatcherToken))
        .expect(404);
      expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
      expect(JSON.stringify(response.body)).not.toMatch(/at \S+ \(|node_modules|Cannot GET/);
    });

    it('refuses a body larger than a batch could ever be', async () => {
      const f = await arrangeFleet(h);
      const huge = { pings: [], padding: 'x'.repeat(2 * 1024 * 1024) };
      await h
        .api()
        .post('/v1/pings')
        .set(...bearer(f.driverTokens[0] as string))
        .send(huge)
        .expect(413);
    });

    it('keeps /metrics behind a token when one is configured', async () => {
      const guarded = await createHarness({ env: { METRICS_TOKEN: 'metrics-token-0123456789' } });
      try {
        await guarded.api().get('/metrics').expect(401);
        await guarded.api().get('/metrics').set('Authorization', 'Bearer wrong-token-0123456789').expect(401);
        const ok = await guarded
          .api()
          .get('/metrics')
          .set('Authorization', 'Bearer metrics-token-0123456789')
          .expect(200);
        expect(ok.text).toContain('pings_received_total');
        expect(ok.text).toContain('http_request_duration_seconds');
      } finally {
        await guarded.close();
      }
    });
  });
});
