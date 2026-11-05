import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import type { LatLng } from '../geo/geo';
import { CircuitBreaker, type BreakerState } from './circuit-breaker';
import { routerUrlAcceptable } from './guards';
import { OsrmClient, type RoadRoute } from './osrm.client';

const CACHE_ENTRIES = 300;
const CACHE_TTL_MS = 5 * 60_000;

/** A key that is the same for two positions a few metres apart: the road between them has not changed. */
export function routeKey(from: LatLng, to: LatLng): string {
  const round = (n: number) => n.toFixed(4); // ~11 m
  return createHash('sha256')
    .update(`${round(from.lat)},${round(from.lng)};${round(to.lat)},${round(to.lng)}`)
    .digest('hex');
}

/**
 * The only door to the router. A road route when the router is configured, healthy and believable; `null` otherwise,
 * and the caller falls back to a straight line AND SAYS SO. It never throws, never blocks beyond the client timeout,
 * and asks the router at most once per distinct (rounded) pair of points per five minutes.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly client: OsrmClient | null;
  readonly breaker = new CircuitBreaker({ failuresToOpen: 4, openForMs: 60_000 });
  private readonly cache = new Map<string, { route: RoadRoute; at: number }>();

  constructor(@Inject(ENV) env: Env) {
    this.client = null;
    if (env.ROUTER_URL) {
      const verdict = routerUrlAcceptable(env.ROUTER_URL);
      if (verdict.ok) this.client = new OsrmClient(env.ROUTER_URL, env.ROUTER_TIMEOUT_MS);
      else this.logger.error(`ROUTER_URL refused (${verdict.reason}); ETAs will be straight-line`);
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  status(): { configured: boolean; breaker: BreakerState; cached: number } {
    return { configured: this.configured, breaker: this.breaker.state(), cached: this.cache.size };
  }

  async route(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
    if (!this.client) return null;

    const key = routeKey(from, to);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      this.cache.delete(key); // re-insert: Map keeps insertion order, so the least recently used is always first
      this.cache.set(key, hit);
      return hit.route;
    }

    if (!this.breaker.tryAcquire()) return null;
    const result = await this.client.route(from, to);
    if (result.ok) {
      this.breaker.success();
      if (this.cache.size >= CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, { route: result.route, at: Date.now() });
      return result.route;
    }
    if (result.kind === 'no_route') this.breaker.success();
    else this.breaker.failure();
    return null;
  }

  /** Lab only. */
  clearCache(): void {
    this.cache.clear();
  }
}
