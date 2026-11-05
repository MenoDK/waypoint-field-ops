import { parseEnv } from '../config/env';
import { RoutingService, routeKey } from './routing.service';

const FROM = { lat: 38.5, lng: -98 };
const TO = { lat: 38.7, lng: -97.8 };
const GOOD = {
  code: 'Ok',
  routes: [
    {
      distance: 31_000,
      duration: 1_800,
      geometry: {
        coordinates: [
          [-98, 38.5],
          [-97.9, 38.6],
          [-97.8, 38.7],
        ],
      },
    },
  ],
};

function env(extra: Record<string, string> = {}) {
  return parseEnv({
    DATABASE_URL: 'x',
    MIGRATION_DATABASE_URL: 'x',
    APP_DB_PASSWORD: 'password-1234',
    JWT_SECRET: 'j'.repeat(32),
    SIGNED_URL_SECRET: 's'.repeat(32),
    ...extra,
  });
}

let calls = 0;
let behaviour: () => Promise<Response>;
beforeEach(() => {
  calls = 0;
  behaviour = async () => new Response(JSON.stringify(GOOD));
  jest.spyOn(globalThis, 'fetch').mockImplementation((async () => {
    calls += 1;
    return behaviour();
  }) as unknown as typeof fetch);
});
afterEach(() => jest.restoreAllMocks());

describe('RoutingService', () => {
  it('is not configured without ROUTER_URL, and never calls out', async () => {
    const service = new RoutingService(env());
    expect(service.configured).toBe(false);
    expect(await service.route(FROM, TO)).toBeNull();
    expect(calls).toBe(0);
  });

  it('refuses a plain-text URL to a public host and stays unconfigured', () => {
    const service = new RoutingService(env({ ROUTER_URL: 'http://router.project-osrm.org' }));
    expect(service.configured).toBe(false);
  });

  it('returns a road route and caches it, so a repeat costs no request', async () => {
    const service = new RoutingService(env({ ROUTER_URL: 'http://router:5000' }));
    const first = await service.route(FROM, TO);
    const second = await service.route({ lat: 38.50001, lng: -98.00001 }, TO); // a metre away: same road
    expect(first?.distanceKm).toBe(31);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it('keys positions that differ by more than ~10 m apart', () => {
    expect(routeKey(FROM, TO)).not.toBe(routeKey({ lat: 38.51, lng: -98 }, TO));
    expect(routeKey(FROM, TO)).toBe(routeKey({ lat: 38.50001, lng: -98 }, TO));
  });

  it('opens the breaker after repeated failures and then stops asking', async () => {
    const service = new RoutingService(env({ ROUTER_URL: 'http://router:5000' }));
    behaviour = async () => new Response('down', { status: 503 });
    for (let i = 0; i < 4; i += 1) expect(await service.route({ lat: 38.5 + i, lng: -98 }, TO)).toBeNull();
    expect(service.breaker.state()).toBe('open');
    const before = calls;
    expect(await service.route({ lat: 30, lng: -98 }, TO)).toBeNull();
    expect(calls).toBe(before);
  });

  it('counts an untrusted answer as a failure, but "no route" as a healthy service', async () => {
    const service = new RoutingService(env({ ROUTER_URL: 'http://router:5000' }));
    behaviour = async () => new Response(JSON.stringify({ code: 'NoRoute' }));
    for (let i = 0; i < 6; i += 1) await service.route({ lat: 38.5 + i / 100, lng: -98 }, TO);
    expect(service.breaker.state()).toBe('closed');

    behaviour = async () =>
      new Response(JSON.stringify({ ...GOOD, routes: [{ ...GOOD.routes[0], distance: 900_000 }] }));
    for (let i = 0; i < 4; i += 1) await service.route({ lat: 39 + i / 100, lng: -98 }, TO);
    expect(service.breaker.state()).toBe('open');
  });

  it('does not cache a failure', async () => {
    const service = new RoutingService(env({ ROUTER_URL: 'http://router:5000' }));
    behaviour = async () => new Response('down', { status: 503 });
    expect(await service.route(FROM, TO)).toBeNull();
    behaviour = async () => new Response(JSON.stringify(GOOD));
    expect((await service.route(FROM, TO))?.distanceKm).toBe(31);
  });
});
