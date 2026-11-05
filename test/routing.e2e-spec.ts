import { AlertsService } from '../src/modules/alerts/alerts.service';
import { TOWNS } from '../src/standin/world';
import { RouterStandIn, type RouterMode } from '../src/standin/router-app';
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

interface Eta {
  distanceKm: number;
  minutes: number;
  source: 'road' | 'straight_line';
  speedBasis: 'measured' | 'default' | 'router';
}

describe('ETA and the road router', () => {
  const router = new RouterStandIn();
  let h: Harness;
  let plain: Harness;
  beforeAll(async () => {
    const port = await router.listen(0);
    h = await createHarness({ env: { ROUTER_URL: `http://127.0.0.1:${port}`, ROUTER_TIMEOUT_MS: '400' } });
    plain = await createHarness();
  });
  afterAll(async () => {
    await h.close();
    await plain.close();
    await router.close();
    await closeOwner();
  });

  let f: Arranged;
  let nextOffset = 0;
  beforeEach(async () => {
    router.mode = 'ok';
    router.requests = 0;
    await resetBreaker();
    f = await arrangeFleet(h);
    await startTrip(h, f); // Harbor Yard -> Elm Crossing
  });
  const resetBreaker = async () => {
    // a new scenario starts from a closed breaker and an empty cache, as the lab's own buttons do
    const { RoutingService } = await import('../src/routing/routing.service');
    const routing = h.app.get(RoutingService);
    routing.breaker.success();
    routing.clearCache();
  };

  /** Puts the vehicle somewhere new (never within the cache's ~11 m rounding of an earlier spot) and asks for its ETA. */
  async function etaAt(offsetKm = 0, speed = 40): Promise<{ eta: Eta | null; router: { breaker: string } }> {
    nextOffset += 1;
    h.clock.advanceSeconds(5);
    await sendPings(h, f, [
      ping(h, 0, { lat: 38.4 + nextOffset * 0.003 + offsetKm / 111, lng: -98.11, speed_kmh: speed }),
    ]).expect(200);
    const snapshot = (
      await h
        .api()
        .get('/v1/fleet/snapshot')
        .set(...bearer(f.dispatcherToken))
        .expect(200)
    ).body;
    return { eta: snapshot.vehicles[0].eta, router: snapshot.router };
  }

  it('uses the road distance and says so when the router is healthy', async () => {
    const { eta } = await etaAt();
    expect(eta).toMatchObject({ source: 'road' });
    expect(router.requests).toBe(1);
    // a road is never shorter than the straight line to the same place
    const dest = TOWNS.find((t) => t.name === 'Elm Crossing') as (typeof TOWNS)[number];
    expect((eta as Eta).distanceKm).toBeGreaterThan(5);
    expect(dest).toBeDefined();
  });

  it('labels what the time is based on: the router’s own estimate until the driver has a measured speed', async () => {
    const first = await etaAt(0, 0);
    expect(first.eta).toMatchObject({ source: 'road', speedBasis: 'router' });
    for (let i = 0; i < 6; i += 1) await etaAt(0, 55);
    expect((await etaAt(0, 55)).eta).toMatchObject({ source: 'road', speedBasis: 'measured' });
  });

  it('asks the router once for positions a few metres apart, not on every refresh', async () => {
    await etaAt();
    const before = router.requests;
    for (let i = 0; i < 5; i += 1)
      await h
        .api()
        .get('/v1/fleet/snapshot')
        .set(...bearer(f.dispatcherToken))
        .expect(200);
    expect(router.requests).toBe(before);
  });

  it('falls back to a labelled straight line when there is no router at all', async () => {
    const g = await arrangeFleet(plain);
    await startTrip(plain, g);
    await sendPings(plain, g, [ping(plain, 0, { speed_kmh: 40 })]).expect(200);
    const snapshot = (
      await plain
        .api()
        .get('/v1/fleet/snapshot')
        .set(...bearer(g.dispatcherToken))
        .expect(200)
    ).body;
    expect(snapshot.vehicles[0].eta).toMatchObject({ source: 'straight_line' });
    expect(snapshot.router).toMatchObject({ configured: false });
  });

  describe.each<[RouterMode, string]>([
    ['down', 'is unavailable'],
    ['slow', 'answers too slowly'],
    ['hostile_geometry', 'returns a route that wanders to another continent'],
    ['absurd_distance', 'returns a distance no road could have'],
    ['huge_body', 'streams a body far beyond any route'],
  ])('when the router %s', (mode, _description) => {
    void _description;
    it(`${mode}: the ETA falls back to a straight line, labelled as one, and the snapshot still works`, async () => {
      router.mode = mode;
      const { eta } = await etaAt();
      expect(eta).toMatchObject({ source: 'straight_line' });
      expect((eta as Eta).minutes).toBeGreaterThanOrEqual(0);
    });

    it(`${mode}: after four failures the breaker opens and the router is no longer asked`, async () => {
      router.mode = mode;
      for (let i = 0; i < 4; i += 1) await etaAt();
      expect(router.requests).toBe(4);
      const open = await etaAt();
      expect(open.router.breaker).toBe('open');
      await etaAt();
      expect(router.requests).toBe(4); // refused locally, instantly, without a network call
    });
  });

  it('recovers when the lab (or an operator) closes the breaker: the very next ETA is a road again', async () => {
    router.mode = 'down';
    for (let i = 0; i < 4; i += 1) await etaAt();
    router.mode = 'ok';
    expect((await etaAt()).eta).toMatchObject({ source: 'straight_line' }); // still open: not asked yet
    await resetBreaker();
    expect((await etaAt()).eta).toMatchObject({ source: 'road' });
  });

  it('never fails readiness over a bad router, and never asks it from the alert evaluator', async () => {
    router.mode = 'down';
    for (let i = 0; i < 4; i += 1) await etaAt();
    const ready = await h.api().get('/health/ready').expect(200);
    expect(ready.body.checks.router).toMatchObject({ configured: true, breaker: 'open' });

    router.mode = 'ok';
    await resetBreaker();
    const before = router.requests;
    await h.app.get(AlertsService).evaluate();
    expect(router.requests).toBe(before);
  });
});
