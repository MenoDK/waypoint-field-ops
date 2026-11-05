import { haversineKm, type LatLng } from '../geo/geo';
import { nearestVertex, pointAlong, shortestPath } from './world';

/**
 * Simulated drivers' phones. Each one is an ordinary client of the public API: it signs in with a password, accepts and starts
 * the trips it is given, drives along the made-up road graph, reports a reading every few seconds, and completes the trip.
 * What makes it useful is that it can also misbehave on command -- lose its connection and upload a backlog later, die,
 * stand still, jitter around the destination, stamp readings with a wrong clock -- so every defence in the server can be
 * watched working. There is no back door: everything the phones do goes through the same endpoints a real app would use.
 */
export const PHONE_MODES = [
  'online',
  'offline',
  'resume',
  'dead',
  'stopped',
  'drive',
  'jitter',
  'bad_clock',
  'teleport',
] as const;
export type PhoneMode = (typeof PHONE_MODES)[number];

export interface ApiResult {
  status: number;
  body: unknown;
}

/** Whatever the phones use to talk to the server. Never throws for an HTTP status; throws for a network failure. */
export interface Api {
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<ApiResult>;
}

interface Reading {
  lat: number;
  lng: number;
  captured_at: string;
  accuracy_m: number;
  speed_kmh: number;
  heading_deg: number;
  source: 'polling' | 'batch';
}

interface Place extends LatLng {
  id: string;
  name: string;
  radius_m: number;
}

interface TripView {
  id: string;
  status: 'PLANNED' | 'ACCEPTED' | 'IN_TRANSIT';
}

export interface PhoneSummary {
  email: string;
  signed_in: boolean;
  mode: PhoneMode[];
  trip: { id: string; status: string; to: string | null; progress_percent: number | null } | null;
  position: LatLng | null;
  buffered: number;
  stats: { sent: number; accepted: number; duplicates: number; rejected: Record<string, number> };
  last_error: string | null;
}

export interface PhoneOptions {
  /** Milliseconds between ticks. */
  tickMs: number;
  /** A reading is sent every this many ticks. */
  reportEvery: number;
  /** Simulated seconds that pass per real second of driving (1 = real time). */
  timeScale: number;
  /** Ticks to wait at the destination, after arriving, before completing the trip. */
  dwellTicks: number;
  /** Ticks an idle phone waits before its dispatcher plans it another trip. */
  replanAfterTicks: number;
  now: () => number;
  random: () => number;
}

export const DEFAULT_PHONE_OPTIONS: PhoneOptions = {
  tickMs: 1000,
  reportEvery: 3,
  timeScale: 1,
  dwellTicks: 8,
  replanAfterTicks: 6,
  now: Date.now,
  random: Math.random,
};

/** Plans a trip for an idle driver, as their dispatcher would. */
export interface Dispatch {
  planNext(driverEmail: string, driverId: string, from: Place | null): Promise<void>;
}

const MAX_BUFFER = 5000;
const CHUNK = 400;
const ARRIVE_KM = 0.04; // the phone parks this close to the destination point
const JITTER_HOLD_KM = 0.35; // while jittering it never gets closer than this on average

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export class Phone {
  private token: string | null = null;
  private userId: string | null = null;
  private flags = { offline: false, dead: false, stopped: false, jitter: false, badClock: false };

  private trip: TripView | null = null;
  private destination: Place | null = null;
  private path: LatLng[] = [];
  private pathKm = 0;
  private progressKm = 0;
  private odometer: number;
  private position: LatLng | null = null;
  private speedKmh = 0;
  private heading = 0;
  private loadingTicks = 0;
  private dwell = 0;
  private idleTicks = 0;
  private waitTicks = 0;
  private ticks = 0;
  private reports = 0;
  private lastStamp = 0;
  private lastPlace: Place | null = null;
  private buffer: Reading[] = [];
  private lastError: string | null = null;
  private stats = { sent: 0, accepted: 0, duplicates: 0, rejected: {} as Record<string, number> };

  constructor(
    readonly email: string,
    private readonly password: string,
    private readonly api: Api,
    private readonly dispatch: Dispatch,
    private readonly options: PhoneOptions = DEFAULT_PHONE_OPTIONS,
  ) {
    this.odometer = 10_000 + Math.floor(options.random() * 80_000);
  }

  /** Forgets everything the server told it (used when the demonstration database is reset under it). */
  reset(): void {
    this.token = null;
    this.userId = null;
    this.trip = null;
    this.destination = null;
    this.path = [];
    this.pathKm = 0;
    this.progressKm = 0;
    this.position = null;
    this.speedKmh = 0;
    this.buffer = [];
    this.lastPlace = null;
    this.idleTicks = 0;
    this.waitTicks = 0;
    this.dwell = 0;
    this.loadingTicks = 0;
    this.lastError = null;
    this.stats = { sent: 0, accepted: 0, duplicates: 0, rejected: {} };
  }

  setMode(mode: PhoneMode): void {
    switch (mode) {
      case 'offline':
        this.flags.offline = true;
        break;
      case 'online':
      case 'resume':
        this.flags.offline = false;
        this.flags.dead = false;
        break;
      case 'dead':
        this.flags.dead = true;
        break;
      case 'stopped':
        this.flags.stopped = true;
        break;
      case 'jitter':
        this.flags.jitter = true;
        break;
      case 'bad_clock':
        this.flags.badClock = true;
        break;
      case 'drive':
        // back to normal driving: every misbehaviour except a broken connection is cleared
        this.flags.stopped = false;
        this.flags.jitter = false;
        this.flags.badClock = false;
        this.flags.dead = false;
        break;
      case 'teleport':
        if (this.path.length > 1) this.progressKm = Math.max(this.progressKm, this.pathKm - 0.6);
        break;
    }
  }

  summary(): PhoneSummary {
    return {
      email: this.email,
      signed_in: this.token !== null,
      mode: (Object.entries(this.flags) as [string, boolean][])
        .filter(([, on]) => on)
        .map(([name]) => (name === 'badClock' ? 'bad_clock' : name) as PhoneMode),
      trip: this.trip
        ? {
            id: this.trip.id,
            status: this.trip.status,
            to: this.destination?.name ?? null,
            progress_percent:
              this.pathKm > 0 ? Math.min(100, Math.round((this.progressKm / this.pathKm) * 100)) : null,
          }
        : null,
      position: this.position,
      buffered: this.buffer.length,
      stats: { ...this.stats, rejected: { ...this.stats.rejected } },
      last_error: this.lastError,
    };
  }

  /** One step of the phone's life. Never throws: a phone that crashed would be a worse demonstration than one that is confused. */
  async tick(): Promise<void> {
    this.ticks += 1;
    if (this.flags.dead) return;
    if (this.waitTicks > 0) {
      this.waitTicks -= 1; // backing off after a refused sign-in: hammering a rate limiter only keeps it shut
      return;
    }
    try {
      if (!this.token) await this.signIn();
      await this.work();
      this.drive();
      if (this.ticks % this.options.reportEvery === 0 && this.position) await this.report();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult> {
    const result = await this.api.request(method, path, { token: this.token ?? undefined, body });
    if (result.status === 401) {
      this.token = null; // expired (or the database was reset): sign in again on the next tick
      throw new Error('signed out');
    }
    return result;
  }

  private async signIn(): Promise<void> {
    const response = await this.api.request('POST', '/v1/auth/login', {
      body: { email: this.email, password: this.password },
    });
    if (response.status !== 200) {
      this.waitTicks = 15;
      throw new Error(`sign-in refused (${response.status})`);
    }
    const body = asRecord(response.body);
    this.token = String(body.access_token);
    this.userId = String(asRecord(body.user).id);
  }

  /** The trip lifecycle: pick up what the dispatcher planned, accept it, start it, finish it, ask for more. */
  private async work(): Promise<void> {
    if (!this.trip) {
      const list = await this.call('GET', '/v1/trips');
      const trips = (Array.isArray(list.body) ? list.body : []) as TripView[];
      const open = trips
        .filter((t) => t.status === 'PLANNED' || t.status === 'ACCEPTED' || t.status === 'IN_TRANSIT')
        .sort((a, b) => order(a.status) - order(b.status));
      this.trip = open[0] ? { id: open[0].id, status: open[0].status } : null;
      if (!this.trip) {
        this.idleTicks += 1;
        if (this.idleTicks >= this.options.replanAfterTicks && this.userId) {
          this.idleTicks = 0;
          await this.dispatch.planNext(this.email, this.userId, this.lastPlace);
        }
        return;
      }
      this.idleTicks = 0;
      this.loadingTicks = 0;
    }

    const trip = this.trip;
    if (trip.status === 'PLANNED') {
      const accepted = await this.call('POST', `/v1/trips/${trip.id}/accept`);
      if (accepted.status === 200) trip.status = 'ACCEPTED';
      else this.trip = null; // someone else moved it (cancelled, or another phone session): look again
      return;
    }
    if (trip.status === 'ACCEPTED') {
      this.loadingTicks += 1;
      if (this.loadingTicks < 2) return; // a driver does not leave in the same second they said yes
      await this.beginRoute(trip);
      const started = await this.call('POST', `/v1/trips/${trip.id}/start`, { km_start: this.odometer });
      if (started.status === 200) trip.status = 'IN_TRANSIT';
      else this.trip = null;
      return;
    }
    // IN_TRANSIT
    if (this.path.length === 0) await this.beginRoute(trip); // the simulator restarted mid-trip: start the road again
    if (this.progressKm >= this.pathKm - ARRIVE_KM && !this.flags.jitter) {
      this.dwell += 1;
      if (this.dwell >= this.options.dwellTicks) await this.finish(trip);
    }
  }

  private async beginRoute(trip: TripView): Promise<void> {
    const route = await this.call('GET', `/v1/trips/${trip.id}/route`);
    const body = asRecord(route.body);
    const origin = placeFrom(body.origin);
    const destination = placeFrom(body.destination);
    if (!origin || !destination) throw new Error('trip has no route');
    const roads = shortestPath(nearestVertex(origin).id, nearestVertex(destination).id);
    this.path = [origin, ...(roads?.vertices ?? []), destination];
    this.pathKm = pathKm(this.path);
    this.progressKm = 0;
    this.destination = destination;
    this.lastPlace = destination;
    this.position = origin;
    this.dwell = 0;
  }

  private async finish(trip: TripView): Promise<void> {
    const kmEnd = this.odometer + Math.max(1, Math.round(this.pathKm));
    const done = await this.call('POST', `/v1/trips/${trip.id}/complete`, { km_end: kmEnd });
    if (done.status === 200) this.odometer = kmEnd;
    this.trip = null;
    this.path = [];
    this.pathKm = 0;
    this.progressKm = 0;
    this.speedKmh = 0;
    this.dwell = 0;
  }

  /** Moves along the road for one tick of simulated time. */
  private drive(): void {
    if (!this.trip || this.trip.status !== 'IN_TRANSIT' || this.path.length < 2) {
      this.speedKmh = 0;
      return;
    }
    const seconds = (this.options.tickMs / 1000) * this.options.timeScale;
    const wanted = 62 + 14 * Math.sin(this.ticks / 17) + 6 * (this.options.random() - 0.5);
    const holdAt = this.flags.jitter ? this.pathKm - JITTER_HOLD_KM : this.pathKm;
    if (!this.flags.stopped) this.progressKm = Math.min(holdAt, this.progressKm + (wanted * seconds) / 3600);
    const parked = this.progressKm >= holdAt;
    this.speedKmh = this.flags.stopped ? 0 : parked ? 2 : wanted;
    const here = pointAlong(this.path, this.progressKm);
    this.position = here.point;
    this.heading = here.heading;
  }

  private reading(): Reading {
    const noise = () => (this.options.random() - 0.5) * 0.00008; // a few metres of GPS noise
    let { lat, lng } = this.position as LatLng;
    let speed = this.speedKmh;
    if (this.flags.jitter && this.destination && this.pathKm - this.progressKm < JITTER_HOLD_KM + 0.01) {
      // alternate between 40 m inside the arrival radius and 300 m outside it, one reading each
      const inside = this.reports % 2 === 0;
      lat = this.destination.lat + (inside ? 0.00035 : 0.0027);
      lng = this.destination.lng;
      speed = 3;
    }
    this.reports += 1;
    // A device never stamps two readings with the same instant: the stamp only moves forward. (A wrong clock is a different
    // sequence entirely -- an hour ahead -- so that switching it off does not leave the good clock stuck in the future.)
    this.lastStamp = Math.max(this.options.now(), this.lastStamp + 1);
    const stamp = this.flags.badClock ? this.options.now() + 3_600_000 + this.reports : this.lastStamp;
    return {
      lat: lat + noise(),
      lng: lng + noise(),
      captured_at: new Date(stamp).toISOString(),
      accuracy_m: 6 + Math.round(this.options.random() * 8),
      speed_kmh: Math.max(0, Math.round(speed * 10) / 10),
      heading_deg: Math.round(this.heading) % 360,
      source: 'polling',
    };
  }

  /** Sends the backlog (oldest first, in batches) and then the new reading; keeps whatever could not be sent. */
  private async report(): Promise<void> {
    this.buffer.push(this.reading());
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    if (this.flags.offline) return;

    while (this.buffer.length > 0) {
      const chunk = this.buffer.slice(0, CHUNK);
      const backlog = chunk.length > 1;
      const pings = chunk.map((r) => (backlog ? { ...r, source: 'batch' as const } : r));
      const response = await this.call('POST', '/v1/pings', { pings });
      if (response.status !== 200) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429)
          this.buffer.splice(0, chunk.length); // will never be accepted
        throw new Error(`pings refused (${response.status})`);
      }
      this.buffer.splice(0, chunk.length);
      const body = asRecord(response.body);
      this.stats.sent += chunk.length;
      this.stats.accepted += Number(body.accepted ?? 0);
      this.stats.duplicates += Number(body.duplicates ?? 0);
      for (const item of Array.isArray(body.rejected) ? body.rejected : []) {
        const reason = String(asRecord(item).reason);
        this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
      }
    }
  }
}

const order = (status: TripView['status']): number =>
  status === 'IN_TRANSIT' ? 0 : status === 'ACCEPTED' ? 1 : 2;

function placeFrom(value: unknown): Place | null {
  const v = asRecord(value);
  if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null;
  return {
    id: String(v.id),
    name: String(v.name),
    lat: v.lat,
    lng: v.lng,
    radius_m: Number(v.radius_m ?? 150),
  };
}

function pathKm(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineKm(path[i - 1] as LatLng, path[i] as LatLng);
  return total;
}
