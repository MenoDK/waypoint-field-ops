import { haversineKm, type LatLng } from '../geo/geo';

/**
 * A made-up region: twelve towns on a grid and the roads between them. It exists so that the demonstration has somewhere to
 * drive without loading map tiles from anyone, and so the router stand-in and the simulated phones agree about where the roads
 * are. Nothing here is a real place. Town names are invented.
 */
export interface Town extends LatLng {
  id: string;
  name: string;
}

const COLUMNS = 4;
const ROWS = 3;
const SOUTH = 38.4;
const WEST = -98.12;
const STEP_LAT = 0.045; // ~5 km
const STEP_LNG = 0.058; // ~5 km at this latitude

const NAMES = [
  ['Harbor Yard', 'Millbrook', 'Cedar Point', 'Stonegate'],
  ['Fairview', 'North Depot', 'Elm Crossing', 'Quarry Hill'],
  ['Lakeside', 'Ridgeway', 'Orchard Park', 'Summit'],
];

export const TOWNS: readonly Town[] = NAMES.flatMap((row, j) =>
  row.map((name, i) => ({ id: `t${i}${j}`, name, lat: SOUTH + j * STEP_LAT, lng: WEST + i * STEP_LNG })),
);

/** Two grid links are missing on purpose, so that the shortest way between some towns is a detour. */
const MISSING = new Set(['t10-t11', 't21-t22']);

export interface Vertex extends LatLng {
  id: string;
}

export interface Road {
  from: string;
  to: string;
  km: number;
}

const SEGMENTS_PER_ROAD = 8;
const WIGGLE_DEG = 0.0016;

function build(): { vertices: Map<string, Vertex>; roads: Road[]; adjacency: Map<string, Road[]> } {
  const vertices = new Map<string, Vertex>();
  const roads: Road[] = [];
  const adjacency = new Map<string, Road[]>();
  const add = (road: Road): void => {
    roads.push(road);
    for (const [a, b] of [
      [road.from, road.to],
      [road.to, road.from],
    ] as const) {
      const list = adjacency.get(a) ?? [];
      list.push({ from: a, to: b, km: road.km });
      adjacency.set(a, list);
    }
  };
  for (const t of TOWNS) vertices.set(t.id, { id: t.id, lat: t.lat, lng: t.lng });

  const link = (a: Town, b: Town): void => {
    const key = `${a.id}-${b.id}`;
    if (MISSING.has(key)) return;
    // The wiggle is a fixed function of the road's name: the same world every time, and a road that is not a ruler line.
    const phase = [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    let previous = a.id;
    for (let s = 1; s <= SEGMENTS_PER_ROAD; s += 1) {
      const f = s / SEGMENTS_PER_ROAD;
      const id = s === SEGMENTS_PER_ROAD ? b.id : `${key}#${s}`;
      const bump = Math.sin(f * Math.PI) * Math.sin(phase + f * 5) * WIGGLE_DEG;
      const vertex: Vertex =
        s === SEGMENTS_PER_ROAD
          ? (vertices.get(b.id) as Vertex)
          : {
              id,
              lat: a.lat + (b.lat - a.lat) * f + (a.lng === b.lng ? 0 : bump),
              lng: a.lng + (b.lng - a.lng) * f + (a.lng === b.lng ? bump : 0),
            };
      vertices.set(vertex.id, vertex);
      add({ from: previous, to: vertex.id, km: haversineKm(vertices.get(previous) as Vertex, vertex) });
      previous = vertex.id;
    }
  };

  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLUMNS; i += 1) {
      const here = TOWNS[j * COLUMNS + i] as Town;
      if (i + 1 < COLUMNS) link(here, TOWNS[j * COLUMNS + i + 1] as Town);
      if (j + 1 < ROWS) link(here, TOWNS[(j + 1) * COLUMNS + i] as Town);
    }
  }
  return { vertices, roads, adjacency };
}

const WORLD = build();
export const VERTICES: ReadonlyMap<string, Vertex> = WORLD.vertices;
export const ROADS: readonly Road[] = WORLD.roads;

/** The vertex closest to a point: where a coordinate "snaps" to the road network. */
export function nearestVertex(point: LatLng): Vertex {
  let best: Vertex | undefined;
  let bestKm = Infinity;
  for (const v of VERTICES.values()) {
    const d = haversineKm(point, v);
    if (d < bestKm) {
      best = v;
      bestKm = d;
    }
  }
  return best as Vertex;
}

export interface RoadPath {
  vertices: Vertex[];
  km: number;
}

/** Dijkstra over the road graph. `null` when the two vertices are not connected. */
export function shortestPath(fromId: string, toId: string): RoadPath | null {
  if (!VERTICES.has(fromId) || !VERTICES.has(toId)) return null;
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([fromId]);
  const done = new Set<string>();
  while (open.size > 0) {
    let current: string | undefined;
    for (const id of open)
      if (current === undefined || (dist.get(id) as number) < (dist.get(current) as number)) current = id;
    const here = current as string;
    open.delete(here);
    if (here === toId) break;
    done.add(here);
    for (const road of WORLD.adjacency.get(here) ?? []) {
      if (done.has(road.to)) continue;
      const candidate = (dist.get(here) as number) + road.km;
      if (candidate < (dist.get(road.to) ?? Infinity)) {
        dist.set(road.to, candidate);
        prev.set(road.to, here);
        open.add(road.to);
      }
    }
  }
  if (!dist.has(toId)) return null;
  const ids = [toId];
  while (ids[0] !== fromId) ids.unshift(prev.get(ids[0] as string) as string);
  return { vertices: ids.map((id) => VERTICES.get(id) as Vertex), km: dist.get(toId) as number };
}

/** The point `km` kilometres along a path, and the compass heading there. Clamped to the ends. */
export function pointAlong(path: readonly LatLng[], km: number): { point: LatLng; heading: number } {
  if (path.length === 0) throw new Error('empty path');
  let remaining = Math.max(0, km);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as LatLng;
    const b = path[i] as LatLng;
    const leg = haversineKm(a, b);
    if (remaining <= leg || i === path.length - 1) {
      const f = leg === 0 ? 1 : Math.min(1, remaining / leg);
      const point = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
      const heading =
        (Math.atan2((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;
      return { point, heading: (heading + 360) % 360 };
    }
    remaining -= leg;
  }
  return { point: path[path.length - 1] as LatLng, heading: 0 };
}
