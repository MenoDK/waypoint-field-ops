import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { haversineKm, type LatLng } from '../geo/geo';
import { nearestVertex, shortestPath } from './world';

/**
 * A stand-in for a road router, speaking the part of the OSRM route protocol that the application uses, over the made-up
 * region's road graph. It exists so the demonstration and the tests have a router whose behaviour can be changed on demand --
 * including the ways a real one goes wrong. It is NOT a routing engine and is not claimed to be one.
 */
export const ROUTER_MODES = [
  'ok',
  'down',
  'slow',
  'hostile_geometry',
  'absurd_distance',
  'huge_body',
] as const;
export type RouterMode = (typeof ROUTER_MODES)[number];

const ROUTE_PATH =
  /^\/route\/v1\/driving\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const CRUISE_KMH = 50;

export class RouterStandIn {
  mode: RouterMode = 'ok';
  requests = 0;
  private readonly server: Server;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  listen(port: number, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        const address = this.server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://router');
    if (url.pathname === '/health') return json(res, 200, { status: 'ok', mode: this.mode });
    const match = ROUTE_PATH.exec(url.pathname);
    if (!match)
      return json(res, 400, {
        code: 'InvalidUrl',
        message: 'Only /route/v1/driving/{lng,lat;lng,lat} is served',
      });
    this.requests += 1;

    const from: LatLng = { lng: Number(match[1]), lat: Number(match[2]) };
    const to: LatLng = { lng: Number(match[3]), lat: Number(match[4]) };

    switch (this.mode) {
      case 'down':
        return json(res, 503, { code: 'ServiceUnavailable' });
      case 'slow': {
        // Longer than any sensible client timeout; released when the client gives up.
        const timer = setTimeout(() => json(res, 200, this.answer(from, to)), 15_000);
        this.timers.add(timer);
        res.on('close', () => {
          clearTimeout(timer);
          this.timers.delete(timer);
        });
        return;
      }
      case 'huge_body':
        return this.hugeBody(res);
      case 'hostile_geometry': {
        const body = this.answer(from, to);
        // One vertex in another hemisphere: a map line across the planet if it were drawn.
        body.routes?.[0]?.geometry.coordinates.splice(1, 0, [from.lng + 40, from.lat + 30]);
        return json(res, 200, body);
      }
      case 'absurd_distance': {
        const body = this.answer(from, to);
        if (body.routes?.[0]) body.routes[0].distance = haversineKm(from, to) * 1000 * 40;
        return json(res, 200, body);
      }
      case 'ok':
        return json(res, 200, this.answer(from, to));
    }
  }

  private answer(from: LatLng, to: LatLng): OsrmAnswer {
    const a = nearestVertex(from);
    const b = nearestVertex(to);
    const path = shortestPath(a.id, b.id);
    if (!path) return { code: 'NoRoute', routes: [] };
    const km = haversineKm(from, a) + path.km + haversineKm(b, to);
    const geometry = [from, ...path.vertices, to].map((p) => [p.lng, p.lat] as [number, number]);
    return {
      code: 'Ok',
      routes: [
        {
          distance: km * 1000,
          duration: (km / CRUISE_KMH) * 3600,
          geometry: { type: 'LineString', coordinates: geometry },
        },
      ],
    };
  }

  /** Streams far more than the client may read, with no Content-Length: the limit has to hold for a body that never ends. */
  private hugeBody(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"code":"Ok","routes":[],"padding":"');
    const chunk = 'x'.repeat(64 * 1024);
    let sent = 0;
    const pump = (): void => {
      while (sent < 16 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return void res.once('drain', pump);
      }
      res.end('"}');
    };
    res.on('error', () => undefined);
    pump();
  }
}

interface OsrmAnswer {
  code: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[];
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}
