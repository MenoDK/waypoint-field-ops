import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  type Api,
  type ApiResult,
  DEFAULT_PHONE_OPTIONS,
  type Dispatch,
  PHONE_MODES,
  Phone,
  type PhoneOptions,
  type PhoneSummary,
} from './phones';
import { ROUTER_MODES, RouterStandIn } from './router-app';

/** The API as the phones see it: plain HTTP, JSON, a bearer token. */
export class HttpApi implements Api {
  constructor(private readonly baseUrl: string) {}

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<ApiResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }
}

interface Catalog {
  drivers: { id: string; vehicle_id: string | null }[];
  places: { id: string; name: string }[];
}

/** The dispatchers behind the phones: when a driver has nothing to do, their dispatcher plans the next trip. */
export class Dispatchers implements Dispatch {
  private readonly tokens = new Map<string, string>();
  private readonly catalogs = new Map<string, Catalog>();

  constructor(
    private readonly api: Api,
    private readonly password: string,
    private readonly random: () => number,
    private readonly now: () => number,
  ) {}

  forget(): void {
    this.tokens.clear();
    this.catalogs.clear();
  }

  async planNext(driverEmail: string, driverId: string, from: { id: string } | null): Promise<void> {
    const email = driverEmail.replace(/^driver\d+@/, 'dispatcher@');
    const token = await this.token(email);
    const catalog = await this.catalog(email, token);
    const driver = catalog.drivers.find((d) => d.id === driverId);
    if (!driver?.vehicle_id) return;
    const origin = catalog.places.find((p) => p.id === from?.id) ?? pick(catalog.places, this.random);
    const destination = pick(
      catalog.places.filter((p) => p.id !== origin.id),
      this.random,
    );
    const planned = await this.api.request('POST', '/v1/trips', {
      token,
      body: {
        vehicle_id: driver.vehicle_id,
        driver_id: driverId,
        origin_id: origin.id,
        destination_id: destination.id,
        planned_departure: new Date(this.now()).toISOString(),
        expected_arrival: new Date(this.now() + 90 * 60_000).toISOString(),
      },
    });
    if (planned.status === 401) this.tokens.delete(email);
    if (planned.status >= 400 && planned.status !== 409) this.catalogs.delete(email); // the data changed under us: look again
  }

  private async token(email: string): Promise<string> {
    const known = this.tokens.get(email);
    if (known) return known;
    const login = await this.api.request('POST', '/v1/auth/login', {
      body: { email, password: this.password },
    });
    const token = (login.body as { access_token?: string } | null)?.access_token;
    if (login.status !== 200 || !token) throw new Error(`dispatcher sign-in refused (${login.status})`);
    this.tokens.set(email, token);
    return token;
  }

  private async catalog(email: string, token: string): Promise<Catalog> {
    const cached = this.catalogs.get(email);
    if (cached) return cached;
    const response = await this.api.request('GET', '/v1/fleet/catalog', { token });
    if (response.status !== 200) throw new Error(`catalog refused (${response.status})`);
    const catalog = response.body as Catalog;
    this.catalogs.set(email, catalog);
    return catalog;
  }
}

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.floor(random() * items.length)] as T;

export interface FieldConfig {
  apiUrl: string;
  password: string;
  drivers: readonly string[];
  phone?: Partial<PhoneOptions>;
}

/** All the phones, the router stand-in, and the one switchboard that the lab uses to give them orders. */
export class Field {
  readonly router = new RouterStandIn();
  readonly phones: Phone[];
  private readonly dispatchers: Dispatchers;
  private readonly options: PhoneOptions;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  readonly startedAt: number;

  constructor(config: FieldConfig, api: Api = new HttpApi(config.apiUrl)) {
    this.options = { ...DEFAULT_PHONE_OPTIONS, ...config.phone };
    this.startedAt = this.options.now();
    this.dispatchers = new Dispatchers(api, config.password, this.options.random, this.options.now);
    this.phones = config.drivers.map(
      (email) => new Phone(email, config.password, api, this.dispatchers, this.options),
    );
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.options.tickMs);
  }

  /** One round for every phone, concurrently. A round that is still running when the next is due is skipped, not stacked. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await Promise.all(this.phones.map((phone) => phone.tick()));
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.router.close().catch(() => undefined);
  }

  setPhone(email: string, mode: (typeof PHONE_MODES)[number]): boolean {
    const phone = this.phones.find((p) => p.email === email);
    if (!phone) return false;
    phone.setMode(mode);
    return true;
  }

  reset(): void {
    this.dispatchers.forget();
    for (const phone of this.phones) phone.reset();
    this.router.mode = 'ok';
    this.router.requests = 0;
  }

  state(): { phones: PhoneSummary[]; router: { mode: string; requests: number }; uptime_seconds: number } {
    return {
      phones: this.phones.map((p) => p.summary()),
      router: { mode: this.router.mode, requests: this.router.requests },
      uptime_seconds: Math.round((this.options.now() - this.startedAt) / 1000),
    };
  }
}

const phoneOrder = z.object({ driver_email: z.string().max(254), mode: z.enum(PHONE_MODES) }).strict();
const routerOrder = z.object({ mode: z.enum(ROUTER_MODES) }).strict();

/** The switchboard: four small endpoints, JSON in and out, nothing it was not built to do. Only the lab talks to it. */
export function controlServer(field: Field): Server {
  return createServer((req, res) => {
    void handleControl(field, req, res).catch(() => send(res, 500, { error: 'internal' }));
  });
}

async function handleControl(field: Field, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://field').pathname;
  if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });
  if (req.method === 'GET' && path === '/control/state') return send(res, 200, field.state());
  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

  if (path === '/control/reset') {
    field.reset();
    return send(res, 200, { status: 'reset' });
  }
  const body = await readJson(req);
  if (path === '/control/phone') {
    const order = phoneOrder.safeParse(body);
    if (!order.success) return send(res, 400, { error: 'invalid order' });
    if (!field.setPhone(order.data.driver_email, order.data.mode))
      return send(res, 404, { error: 'unknown phone' });
    return send(res, 200, field.state());
  }
  if (path === '/control/router') {
    const order = routerOrder.safeParse(body);
    if (!order.success) return send(res, 400, { error: 'invalid order' });
    field.router.mode = order.data.mode;
    return send(res, 200, field.state());
  }
  return send(res, 404, { error: 'not found' });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4096) return null; // an order is a few dozen bytes
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}
