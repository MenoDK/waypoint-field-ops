import { AlertsService } from '../../src/modules/alerts/alerts.service';
import { RouterStandIn } from '../../src/standin/router-app';
import {
  type Arranged,
  arrangeFleet,
  bearer,
  createHarness,
  type Harness,
  ping,
  startTrip,
  TestClock,
  wipe,
} from './harness';

/**
 * What the landing page's tour shows. Nothing there is typed by hand: this file drives the real application (the same Nest
 * app the other specs use, on a real PostGIS) and writes down what it answered. `transcripts.e2e-spec.ts` records again and
 * fails when `site/transcripts.js` no longer matches, so the page cannot drift away from the code.
 */

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface Reply {
  status: number;
  text: string;
}

/**
 * The kit inserts a transcript as HTML, so every character is escaped here and the four classes it styles (`tok-dim` for
 * the story, `tok-k` for a request, `tok-ok` and `tok-bad` for the answer) are added around whole lines. A placeholder such
 * as `<id-1>` therefore reaches the reader as text, not as a tag.
 */
class Tape {
  readonly #entries: { cls?: string; text: string }[] = [];

  say(text: string): void {
    if (this.#entries.length > 0) this.#entries.push({ text: '' });
    this.#entries.push({ cls: 'tok-dim', text: `# ${text}` });
  }

  call(request: string, expected: number, reply: Reply, shown?: (json: unknown) => unknown): void {
    // A transcript is evidence. If the application stops answering what the story says, recording must fail loudly
    // instead of writing a page that tells a different story.
    if (reply.status !== expected) {
      throw new Error(`${request}: expected ${expected}, got ${reply.status} ${reply.text.slice(0, 200)}`);
    }
    this.#entries.push({ cls: 'tok-k', text: `→ ${request}` });
    this.#entries.push({ cls: reply.status < 400 ? 'tok-ok' : 'tok-bad', text: `← ${reply.status}` });
    let body: unknown = reply.text;
    try {
      body = JSON.parse(reply.text);
    } catch {
      /* not JSON (a PDF, say): keep the text */
    }
    const content = shown && typeof body === 'object' ? shown(body) : body;
    this.#entries.push({ text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) });
  }

  /** Something the worker does, not a request: shown as a command and its result. */
  internal(command: string, result: unknown): void {
    this.#entries.push({ cls: 'tok-k', text: `⟳ ${command}` });
    this.#entries.push({ text: JSON.stringify(result, null, 2) });
  }

  raw(line: string): void {
    this.#entries.push({ text: line });
  }

  /** `transform` runs on the raw text of each line, before escaping, in order. */
  render(transform: (text: string) => string): string {
    return this.#entries
      .map(({ cls, text }) => {
        const shown = escapeHtml(transform(text));
        return cls ? `<span class="${cls}">${shown}</span>` : shown;
      })
      .join('\n');
  }
}

/** Ids, instants and signatures change on every run; what they mean does not. Replace them in order of appearance. */
function normaliser(): (text: string) => string {
  const seen = new Map<string, string>();
  const counters = { id: 0, time: 0 };
  const named = (kind: 'id' | 'time', value: string): string => {
    const key = `${kind}:${value}`;
    if (!seen.has(key)) {
      counters[kind] += 1;
      seen.set(key, `<${kind}-${counters[kind]}>`);
    }
    return seen.get(key) as string;
  };
  return (text) =>
    text
      .replace(/sig=[A-Za-z0-9_-]{43}/g, 'sig=<signature>')
      .replace(/exp=\d{10}/g, 'exp=<expiry>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => named('id', id))
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (time) => named('time', time));
}

const NO_SUCH_TRIP = '00000000-0000-4000-8000-000000000000';

const post = (h: Harness, token: string, path: string, body?: unknown) =>
  h
    .api()
    .post(path)
    .set(...bearer(token))
    .send(body as object | undefined);
const get = (h: Harness, token: string, path: string) =>
  h
    .api()
    .get(path)
    .set(...bearer(token));
const reply = (res: { status: number; text: string }): Reply => ({ status: res.status, text: res.text });

/** A reading `minutesAgo` before the harness clock, at a place, with the accuracy a phone would report. */
const reading = (
  h: Harness,
  minutesAgo: number,
  lat: number,
  lng: number,
  over: Record<string, unknown> = {},
) => ping(h, minutesAgo, { lat, lng, ...over });

async function ingest(h: Harness): Promise<string> {
  const f = await arrangeFleet(h);
  const driver = f.driverTokens[0] as string;
  const tape = new Tape();

  tape.say(
    'A phone comes out of a tunnel with six readings: three good, one with no GPS fix (0, 0), one stamped two hours in the future, one older than the retention window.',
  );
  const batch = {
    pings: [
      reading(h, 10, 38.401, -98.12),
      reading(h, 9, 38.402, -98.12),
      reading(h, 8, 38.403, -98.12),
      reading(h, 7, 0, 0),
      reading(h, -120, 38.404, -98.12),
      reading(h, 30 * 24 * 60, 38.405, -98.12),
    ],
  };
  tape.call('POST /v1/pings   (6 readings)', 200, reply(await post(h, driver, '/v1/pings', batch)));

  tape.say('The phone did not see the answer and sends the same batch again. Nothing is stored twice.');
  tape.call('POST /v1/pings   (the same 6 readings)', 200, reply(await post(h, driver, '/v1/pings', batch)));

  tape.say(
    'A reading older than the newest one arrives late. It is kept in the history, but the vehicle does not move backwards.',
  );
  tape.call(
    'POST /v1/pings   (1 reading, 20 minutes old)',
    200,
    reply(await post(h, driver, '/v1/pings', { pings: [reading(h, 20, 38.4, -98.119)] })),
  );

  tape.say(
    'A body that names a driver is refused whole. The driver comes from the token, never from the request.',
  );
  tape.call(
    'POST /v1/pings   (a reading with a driver_id)',
    400,
    reply(
      await post(h, driver, '/v1/pings', {
        pings: [{ ...reading(h, 0, 38.4, -98.12), driver_id: NO_SUCH_TRIP }],
      }),
    ),
    (json) => ({ error: (json as { error: { code: string; message: string } }).error }),
  );
  return tape.render(normaliser());
}

async function arrival(h: Harness): Promise<string> {
  const f = await arrangeFleet(h);
  const driver = f.driverTokens[0] as string;
  const tripId = await startTrip(h, f, 0, 'Harbor Yard', 'Elm Crossing');
  h.clock.advanceMinutes(10); // the fixes below were captured after the trip began, as they would be on the road
  const tape = new Tape();
  const trip = async () => {
    const res = await get(h, f.dispatcherToken, `/v1/trips/${tripId}`);
    const t = JSON.parse(res.text) as { status: string; arrived_at: string | null };
    return { status: t.status, arrived_at: t.arrived_at };
  };
  // Elm Crossing, the destination, is 150 m wide.
  const inside = (minutesAgo: number, over: Record<string, unknown> = {}) =>
    reading(h, minutesAgo, 38.4452, -98.004, over);

  tape.say(
    'The trip is under way to Elm Crossing (a 150 m radius). One accurate fix inside the radius could be GPS jitter, so it is not an arrival.',
  );
  tape.call(
    'POST /v1/pings   (1 accurate fix inside)',
    200,
    reply(await post(h, driver, '/v1/pings', { pings: [inside(5)] })),
  );
  tape.raw(JSON.stringify(await trip(), null, 2));

  tape.say('A second fix inside, but one that admits ±400 m of error, is too vague to confirm anything.');
  tape.call(
    'POST /v1/pings   (1 fix inside, accuracy 400 m)',
    200,
    reply(await post(h, driver, '/v1/pings', { pings: [inside(3, { accuracy_m: 400 })] })),
  );
  tape.raw(JSON.stringify(await trip(), null, 2));

  tape.say('A second accurate fix inside the radius: two in a row. The trip has arrived.');
  tape.call(
    'POST /v1/pings   (1 accurate fix inside)',
    200,
    reply(await post(h, driver, '/v1/pings', { pings: [inside(1)] })),
  );
  tape.raw(JSON.stringify(await trip(), null, 2));

  tape.say(
    'The same fixes arrive again, from a retry. The arrival is stamped once, with a conditional update, and keeps its time.',
  );
  tape.call(
    'POST /v1/pings   (all three fixes again)',
    200,
    reply(
      await post(h, driver, '/v1/pings', { pings: [inside(5), inside(3, { accuracy_m: 400 }), inside(1)] }),
    ),
  );
  tape.raw(JSON.stringify(await trip(), null, 2));
  return tape.render(normaliser());
}

async function alerts(h: Harness): Promise<string> {
  await wipe(h); // the evaluator looks at every fleet, so this scene needs the database to itself
  const f = await arrangeFleet(h);
  const driver = f.driverTokens[0] as string;
  await startTrip(h, f);
  const evaluator = h.app.get(AlertsService);
  const tape = new Tape();
  const list = async () => {
    const res = await get(h, f.dispatcherToken, '/v1/alerts');
    return (
      JSON.parse(res.text) as {
        kind: string;
        status: string;
        detail: unknown;
        opened_at: string;
        cleared_at: string | null;
      }[]
    ).map((a) => ({
      kind: a.kind,
      status: a.status,
      detail: a.detail,
      opened_at: a.opened_at,
      cleared_at: a.cleared_at,
    }));
  };

  tape.say('The phone reports once, then goes quiet.');
  tape.call(
    'POST /v1/pings   (1 reading)',
    200,
    reply(await post(h, driver, '/v1/pings', { pings: [reading(h, 0, 38.41, -98.119)] })),
  );

  h.clock.advanceMinutes(16);
  tape.say(
    'Sixteen minutes later the scheduled evaluator (the worker runs it every 30 seconds) compares the facts with the open alerts.',
  );
  tape.internal('worker: alerts.evaluate()', await evaluator.evaluate());
  tape.raw(JSON.stringify(await list(), null, 2));

  tape.say(
    'It runs again, or three workers run it at once. A partial unique index allows one open alert per vehicle and kind, so nothing new opens.',
  );
  tape.internal('worker: alerts.evaluate()', await evaluator.evaluate());

  h.clock.advanceMinutes(2);
  tape.say(
    'The phone reports again. The next evaluation sees a recent position and clears the alert, keeping when it opened.',
  );
  tape.call(
    'POST /v1/pings   (1 reading)',
    200,
    reply(await post(h, driver, '/v1/pings', { pings: [reading(h, 0, 38.42, -98.119)] })),
  );
  tape.internal('worker: alerts.evaluate()', await evaluator.evaluate());
  tape.raw(JSON.stringify(await list(), null, 2));
  return tape.render(normaliser());
}

async function queue(h: Harness): Promise<string> {
  const f: Arranged = await arrangeFleet(h, { unit: { name: 'Mobile Unit 1', capacity: 3 } });
  const unitId = f.unitId as string;
  const token = f.dispatcherToken;
  const tape = new Tape();
  const board = async () => {
    const res = await get(h, token, `/v1/units/${unitId}/board`);
    const b = JSON.parse(res.text) as {
      on_board: number;
      free_places: number | null;
      warning: string | null;
      tickets: { person_ref: string; status: string }[];
    };
    return {
      on_board: b.on_board,
      free_places: b.free_places,
      tickets: b.tickets.map((t) => `${t.person_ref}: ${t.status}`),
    };
  };

  tape.say(
    'A mobile unit holds 3 people. Five people join the queue (one request each; the first is shown).',
  );
  const first = await post(h, token, `/v1/units/${unitId}/tickets`, {
    person_ref: 'guest-1',
    service: 'loading',
  });
  tape.call(
    'POST /v1/units/<unit>/tickets   (guest-1)',
    200,
    reply(first),
    (j) => (j as { ticket: { person_ref: string; status: string } }).ticket,
  );
  for (const n of [2, 3, 4, 5])
    await post(h, token, `/v1/units/${unitId}/tickets`, { person_ref: `guest-${n}`, service: 'loading' });

  tape.say(
    'The dispatcher calls the next five. One rule decides how many fit, with the unit row locked while it does.',
  );
  const next = await post(h, token, `/v1/units/${unitId}/call-next`, { count: 5 });
  tape.call('POST /v1/units/<unit>/call-next   {"count": 5}', 200, reply(next), (j) => {
    // The plan also reports the state it was made from; the board below shows the state it led to.
    const p = j as { capacity: number; reason: string; calls: { personRef: string }[] };
    return { called: p.calls.map((c) => c.personRef), capacity: p.capacity, reason: p.reason };
  });
  tape.raw(JSON.stringify(await board(), null, 2));

  tape.say('Now somebody calls guest-4 by hand. A different entry point, the same rule.');
  const waiting = (
    await (async () =>
      JSON.parse((await get(h, token, `/v1/units/${unitId}/board`)).text) as {
        tickets: { id: string; person_ref: string; status: string }[];
      })()
  ).tickets.find((t) => t.status === 'waiting');
  tape.call(
    `POST /v1/tickets/<ticket>/call   (${waiting?.person_ref})`,
    409,
    reply(await post(h, token, `/v1/tickets/${waiting?.id}/call`)),
  );

  tape.say('One person is served and finishes. A place frees up, and the same call now works.');
  const called = (
    JSON.parse((await get(h, token, `/v1/units/${unitId}/board`)).text) as {
      tickets: { id: string; status: string }[];
    }
  ).tickets.find((t) => t.status === 'called');
  await post(h, token, `/v1/tickets/${called?.id}/serve`);
  await post(h, token, `/v1/tickets/${called?.id}/finish`);
  tape.call(
    `POST /v1/tickets/<ticket>/call   (${waiting?.person_ref})`,
    200,
    reply(await post(h, token, `/v1/tickets/${waiting?.id}/call`)),
    (j) => {
      const t = j as { person_ref: string; status: string };
      return { person_ref: t.person_ref, status: t.status };
    },
  );
  return tape.render(normaliser());
}

async function boundaries(h: Harness, router: RouterStandIn): Promise<string> {
  const a = await arrangeFleet(h);
  const b = await arrangeFleet(h);
  const tripA = await startTrip(h, a);
  const tape = new Tape();

  tape.say(
    'A dispatcher of another fleet asks for this fleet’s trip, and then for a trip that never existed. Same answer: the other fleet’s data does not exist for them.',
  );
  tape.call(
    'GET /v1/trips/<fleet A’s trip>   (as fleet B)',
    404,
    reply(await get(h, b.dispatcherToken, `/v1/trips/${tripA}`)),
  );
  tape.call(
    'GET /v1/trips/<no such trip>   (as fleet B)',
    404,
    reply(await get(h, b.dispatcherToken, `/v1/trips/${NO_SUCH_TRIP}`)),
  );

  tape.say(
    'The trip sheet is a PDF behind a signed link: an HMAC over the trip, the fleet and the expiry. The genuine link opens it.',
  );
  const minted = JSON.parse((await post(h, a.dispatcherToken, `/v1/trips/${tripA}/sheet-link`)).text) as {
    url: string;
  };
  const opened = await h.api().get(minted.url);
  tape.call('GET <the link>', 200, {
    status: opened.status,
    text: opened.status === 200 ? `(a PDF, content-type ${opened.headers['content-type']})` : opened.text,
  });

  tape.say('One character of the signature changed. The answer says nothing about why.');
  const sig = /sig=([A-Za-z0-9_-]+)/.exec(minted.url)?.[1] as string;
  const altered = minted.url.replace(sig, `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`);
  tape.call('GET <the link, one signature character changed>', 403, reply(await h.api().get(altered)));

  tape.say(
    'Past its expiry, a genuine link says so. Only someone holding a link the server really signed learns that.',
  );
  h.clock.advanceSeconds(h.env.SIGNED_URL_TTL_SECONDS + 5);
  tape.call('GET <the genuine link, after it expires>', 410, reply(await h.api().get(minted.url)));

  tape.say(
    'The road router returns a route with a vertex thousands of kilometres away. The application refuses it and the ETA says it fell back to a straight line.',
  );
  const eta = (json: unknown) => {
    const snap = json as {
      vehicles: { trip: { id: string } | null; eta: unknown }[];
      router: { breaker: string };
    };
    return { eta: snap.vehicles.find((v) => v.trip?.id === tripA)?.eta, router_breaker: snap.router.breaker };
  };
  const moveTo = async (lat: number, lng: number) => {
    h.clock.advanceSeconds(30); // a reading with the same capture time as the last would be a duplicate
    await post(h, a.driverTokens[0] as string, '/v1/pings', {
      pings: [reading(h, 0, lat, lng, { speed_kmh: 40 })],
    });
  };
  await moveTo(38.41, -98.119);
  tape.call(
    'GET /v1/fleet/snapshot   (router healthy)',
    200,
    reply(await get(h, a.dispatcherToken, '/v1/fleet/snapshot')),
    eta,
  );
  router.mode = 'hostile_geometry';
  await moveTo(38.42, -98.118);
  tape.call(
    'GET /v1/fleet/snapshot   (router answers with hostile geometry)',
    200,
    reply(await get(h, a.dispatcherToken, '/v1/fleet/snapshot')),
    eta,
  );
  router.mode = 'ok';
  return tape.render(normaliser());
}

/**
 * Records every scene against the real application. The clock starts at the real time (the daily partitions follow the real
 * date); instants and ids are replaced by placeholders, so two recordings are identical.
 */
export async function recordTranscripts(): Promise<Record<string, string>> {
  const router = new RouterStandIn();
  const port = await router.listen(0);
  const h = await createHarness({
    clock: new TestClock(),
    env: { ROUTER_URL: `http://127.0.0.1:${port}`, ROUTER_TIMEOUT_MS: '400' },
  });
  try {
    const out: Record<string, string> = {};
    out.ingest = await ingest(h);
    out.arrival = await arrival(h);
    out.alerts = await alerts(h);
    out.queue = await queue(h);
    out.boundaries = await boundaries(h, router);
    return out;
  } finally {
    await h.close();
    await router.close();
  }
}

export const renderFile = (recorded: Record<string, string>): string =>
  `/* Recorded from the running application by test/transcripts.e2e-spec.ts. Do not edit: a test records again and compares. */\nwindow.TRANSCRIPTS = ${JSON.stringify(recorded, null, 2)};\n`;
