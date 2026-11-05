/* The lab: five tabs, each one a way to push on the system. Loaded before kit.js; it only declares things.
   Everything that came from the API is inserted as text (or escaped, for the map). The page signs in as the invented demo
   users through /api/lab/session, so there is no login screen: the lab routes exist only when the server runs in lab mode. */
(() => {
  'use strict';

  /* The real-time contract: every event name the server emits. test/site-contract.spec.ts reads this list and fails if it
     differs from src/realtime/events.ts, so a renamed event cannot leave this screen listening to nothing. */
  const EVENT_NAMES = [
    'position',
    'alert.opened',
    'alert.cleared',
    'trip.updated',
    'trip.arrived',
    'queue.updated',
    'ticket.called',
  ];

  const PRAIRIE = 'dispatcher@prairie.example.test';
  const HARBOR = 'dispatcher@harbor.example.test';
  const MANUAL_DRIVER = 'driver4@prairie.example.test';

  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const clock = (iso) => (iso ? new Date(iso).toISOString().slice(11, 19) : '—');
  const short = (id) => (id ? String(id).slice(0, 8) : '—');
  const signalKind = (s) => ({ online: 'ok', stale: 'warn', offline: 'bad' })[s] || '';

  /* ---------------------------------------------------------------- signing in as the demo users */
  const tokens = new Map();
  const sockets = new Set();

  async function tokenFor(email, fresh = false) {
    const hit = tokens.get(email);
    if (hit && !fresh && Date.now() - hit.at < 600_000) return hit.token;
    const r = await window.Kit.api('/api/lab/session', { method: 'POST', body: { email }, auth: false });
    if (!r.ok)
      throw new Error(`Could not sign in as ${email} (${r.status}). Is the lab running in lab mode?`);
    tokens.set(email, { token: r.data.access_token, at: Date.now() });
    return r.data.access_token;
  }
  async function as(email, path, options = {}) {
    const token = await tokenFor(email);
    return window.Kit.api(path, {
      ...options,
      auth: false,
      headers: { ...(options.headers || {}), authorization: `Bearer ${token}` },
    });
  }
  const labState = async () => {
    const r = await window.Kit.api('/api/lab/state', { auth: false });
    if (!r.ok) throw new Error('Could not read the lab state.');
    return r.data;
  };
  const fieldCommand = (path, body) => window.Kit.api(path, { method: 'POST', body, auth: false });

  /** Opens a Socket.IO connection as a demo user. Closed when the lab resets or the tab is replaced. */
  async function openSocket(email, { token, reconnect = true } = {}) {
    if (typeof window.io !== 'function')
      throw new Error('The Socket.IO client did not load from /socket.io/socket.io.js.');
    const first = token === undefined ? await tokenFor(email) : token;
    const socket = window.io({
      auth: first ? { token: first } : {},
      transports: ['websocket'],
      reconnection: reconnect,
    });
    sockets.add(socket);
    if (reconnect && email) {
      // The server cuts a socket when its access token expires; come back with a fresh one.
      socket.on('disconnect', async (reason) => {
        if (reason !== 'io server disconnect' || !sockets.has(socket)) return;
        try {
          socket.auth = { token: await tokenFor(email, true) };
          socket.connect();
        } catch {
          /* the lab was reset or the server is down: nothing to reconnect to */
        }
      });
    }
    return socket;
  }
  function closeSockets() {
    for (const s of sockets) s.close();
    sockets.clear();
  }

  /** Runs `fn` every `ms` while the panel is on screen. Failures are silent: the next tick tries again. */
  function poll(panel, fn, ms) {
    let running = false;
    const tick = async () => {
      if (!panel.isConnected) return clearInterval(timer);
      if (panel.hidden || document.hidden || running) return undefined;
      running = true;
      try {
        await fn();
      } catch {
        /* a hiccup in one refresh is not worth a toast every two seconds */
      } finally {
        running = false;
      }
      return undefined;
    };
    const timer = setInterval(tick, ms);
    return tick;
  }

  /* ---------------------------------------------------------------- the map (inline SVG, no tiles, no library) */
  function mapSvg(model) {
    const W = 640;
    const H = 400;
    const PAD = 38;
    const places = model.places;
    if (places.length === 0) return '';
    const lats = places.map((p) => p.lat);
    const lngs = places.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * kx, 1e-6);
    const spanY = Math.max(maxLat - minLat, 1e-6);
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const offX = (W - 2 * PAD - spanX * scale) / 2;
    const offY = (H - 2 * PAD - spanY * scale) / 2;
    const X = (lng) => (PAD + offX + (lng - minLng) * kx * scale).toFixed(1);
    const Y = (lat) => (H - PAD - offY - (lat - minLat) * scale).toFixed(1);
    const byId = new Map(places.map((p) => [p.name, p]));

    const parts = [];
    for (const v of model.vehicles) {
      const origin = v.trip && byId.get(v.trip.origin);
      const destination = v.trip && byId.get(v.trip.destination);
      if (origin && destination)
        parts.push(
          `<path class="road" d="M${X(origin.lng)} ${Y(origin.lat)}L${X(destination.lng)} ${Y(destination.lat)}"/>`,
        );
      if (destination && v.trip.status === 'IN_TRANSIT')
        parts.push(`<circle class="ring" cx="${X(destination.lng)}" cy="${Y(destination.lat)}" r="14"/>`);
    }
    for (const line of model.trails.values()) {
      if (line.length > 1)
        parts.push(
          `<polyline class="trail" points="${line.map(([lng, lat]) => `${X(lng)},${Y(lat)}`).join(' ')}"/>`,
        );
    }
    for (const p of places) {
      parts.push(
        `<circle class="town" cx="${X(p.lng)}" cy="${Y(p.lat)}" r="5"/><text class="town-name" x="${X(p.lng)}" y="${(Number(Y(p.lat)) + 19).toFixed(1)}" text-anchor="middle">${esc(p.name)}</text>`,
      );
    }
    let shown = 0;
    for (const v of model.vehicles) {
      const live = model.live.get(v.driver_id);
      const pos = live || v.position;
      if (!pos) continue;
      shown += 1;
      parts.push(
        `<circle class="veh ${esc(v.signal)}" cx="${X(pos.lng)}" cy="${Y(pos.lat)}" r="7"/><text class="veh-name" x="${(Number(X(pos.lng)) + 11).toFixed(1)}" y="${(Number(Y(pos.lat)) + 4).toFixed(1)}">${esc(v.vehicle)}</text>`,
      );
    }
    return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`A map of ${places.length} towns with ${shown} vehicles on it. The same information is listed in the table beside it.`)}">${parts.join('')}</svg>`;
  }

  /* ---------------------------------------------------------------- field: the map, the phones, the alerts */
  async function fieldTab(panel, k) {
    const { h, button, badge, box, out, toast } = k;
    const model = {
      places: [],
      vehicles: [],
      trails: new Map(),
      live: new Map(),
      alerts: [],
      field: null,
      accounts: [],
      thresholds: null,
    };
    const driverName = (id) => model.vehicles.find((v) => v.driver_id === id)?.driver_name || short(id);
    const vehicleName = (id) => model.vehicles.find((v) => v.vehicle_id === id)?.vehicle || short(id);

    const mapBox = h('div', {});
    const stamp = h('p', { class: 'hint' }, 'Loading…');
    const phones = h('div', {});
    const alerts = h('div', {});
    const feed = h('ul', { class: 'feed', 'aria-live': 'off', 'aria-label': 'Real-time events' });
    const feedHead = h('p', { class: 'hint' }, 'Waiting for the first event…');
    const driverSel = h('select', { id: 'f-driver' });
    const evalOut = h('div', {});
    let positions = 0;
    let trailTick = 0;

    const summary = (name, p) => {
      if (name === 'alert.opened' || name === 'alert.cleared')
        return `${p.kind} · ${driverName(p.driver_id)}`;
      if (name === 'trip.updated') return `${p.status} · ${vehicleName(p.vehicle_id)}`;
      if (name === 'trip.arrived') return `${driverName(p.driver_id)} arrived`;
      if (name === 'queue.updated') return `waiting ${p.waiting} · on board ${p.on_board}`;
      if (name === 'ticket.called') return `${p.person_ref} · ${p.service}`;
      return '';
    };
    const pushEvent = (name, p) => {
      if (name === 'position') {
        positions += 1;
        model.live.set(p.driver_id, { lat: p.lat, lng: p.lng });
        feedHead.textContent = `${positions} position event(s) so far (not listed one by one) · the other events are below`;
        return;
      }
      feed.prepend(
        h(
          'li',
          {},
          h('time', {}, clock(new Date().toISOString())),
          h('span', { class: 'ev' }, name),
          h('span', { class: 'what' }, summary(name, p)),
        ),
      );
      while (feed.children.length > 40) feed.lastChild.remove();
      if (
        name === 'alert.opened' ||
        name === 'alert.cleared' ||
        name === 'trip.arrived' ||
        name === 'trip.updated'
      )
        void refresh();
    };

    async function refresh() {
      const [snapshot, alertList, field, state] = await Promise.all([
        as(PRAIRIE, '/v1/fleet/snapshot'),
        as(PRAIRIE, '/v1/alerts'),
        window.Kit.api('/api/lab/field', { auth: false }),
        labState(),
      ]);
      if (!snapshot.ok) throw new Error(`Snapshot answered ${snapshot.status}`);
      if (model.places.length === 0) {
        const catalog = await as(PRAIRIE, '/v1/fleet/catalog');
        if (catalog.ok) model.places = catalog.data.places;
      }
      model.vehicles = snapshot.data.vehicles;
      model.alerts = alertList.ok ? alertList.data : [];
      model.field = field.ok ? field.data : null;
      model.thresholds = state.thresholds;
      model.accounts = state.accounts.filter(
        (a) => a.role === 'driver' && a.email.endsWith('@prairie.example.test'),
      );
      for (const v of model.vehicles) {
        if (v.position) model.live.set(v.driver_id, { lat: v.position.lat, lng: v.position.lng });
      }
      if (trailTick % 3 === 0) {
        await Promise.all(
          model.vehicles
            .filter((v) => v.trip && v.trip.status !== 'PLANNED')
            .map(async (v) => {
              const t = await as(PRAIRIE, `/v1/trips/${v.trip.id}/trail`);
              if (t.ok && t.data.geometry) model.trails.set(v.trip.id, t.data.geometry.coordinates);
            }),
        );
      }
      trailTick += 1;
      draw();
    }

    function draw() {
      mapBox.innerHTML = mapSvg(model);
      stamp.textContent = `Updated ${clock(new Date().toISOString())} UTC · positions arrive by socket, the rest is read every two seconds`;
      const phoneByEmail = new Map((model.field?.phones || []).map((p) => [p.email, p]));
      const emailOf = (name) => model.accounts.find((a) => a.name === name)?.email;
      if (driverSel.options.length !== model.accounts.length) {
        const keep = driverSel.value;
        driverSel.replaceChildren(
          ...model.accounts.map((a) =>
            h('option', { value: a.email }, `${a.name} · ${a.email.split('@')[0]}`),
          ),
        );
        if (keep) driverSel.value = keep;
      }
      phones.replaceChildren(
        h(
          'table',
          { class: 'phones-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ['Vehicle', 'Signal', 'Trip', 'ETA', 'Phone'].map((c) => h('th', { scope: 'col' }, c)),
            ),
          ),
          h(
            'tbody',
            {},
            model.vehicles.map((v) => {
              const phone = phoneByEmail.get(emailOf(v.driver_name));
              const flags = (phone?.mode || []).map((m) => badge(m, 'warn'));
              return h(
                'tr',
                {},
                h('td', {}, h('strong', {}, v.vehicle), h('div', { class: 'hint' }, v.driver_name)),
                h(
                  'td',
                  {},
                  badge(v.position ? v.signal : 'never reported', v.position ? signalKind(v.signal) : ''),
                  v.position ? h('div', { class: 'hint' }, `${v.motion} · ${v.age_seconds}s ago`) : null,
                ),
                h(
                  'td',
                  {},
                  v.trip ? `${v.trip.status.toLowerCase().replace('_', ' ')} → ${v.trip.destination}` : '—',
                  v.trip && v.trip.progress_percent !== null
                    ? h('div', { class: 'hint' }, `${v.trip.progress_percent}%`)
                    : null,
                ),
                h(
                  'td',
                  {},
                  v.eta ? `${v.eta.minutes} min` : '—',
                  v.eta ? h('div', { class: 'hint' }, `${v.eta.source} · ${v.eta.speedBasis}`) : null,
                ),
                h(
                  'td',
                  {},
                  phone
                    ? [...flags, phone.buffered ? badge(`${phone.buffered} buffered`, 'warn') : null]
                    : h('span', { class: 'hint' }, 'none (sent by hand)'),
                  phone
                    ? h(
                        'div',
                        { class: 'hint' },
                        `sent ${phone.stats.sent} · accepted ${phone.stats.accepted} · duplicates ${phone.stats.duplicates}`,
                      )
                    : null,
                ),
              );
            }),
          ),
        ),
      );
      alerts.replaceChildren(
        model.alerts.length
          ? h(
              'ul',
              { class: 'trace' },
              model.alerts
                .slice(0, 8)
                .map((a) =>
                  h(
                    'li',
                    {},
                    h('strong', {}, a.driver_name),
                    badge(a.kind, 'bad'),
                    badge(a.status, a.status === 'open' ? 'warn' : 'ok'),
                    h(
                      'span',
                      {},
                      `opened ${clock(a.opened_at)}${a.cleared_at ? ` · cleared ${clock(a.cleared_at)}` : ''}`,
                    ),
                  ),
                ),
            )
          : h('p', { class: 'hint' }, 'No alerts. Kill a phone’s signal and wait for the threshold.'),
      );
    }

    const order = (mode, label, options = {}) =>
      button(
        label,
        async () => {
          const r = await fieldCommand('/api/lab/field/phone', { driver_email: driverSel.value, mode });
          if (!r.ok) throw new Error(r.data?.error?.message || `The field stand-in answered ${r.status}`);
          toast(`${label}: sent to the phone.`);
          await refresh();
        },
        { small: true, ...options },
      );

    panel.append(
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          box(
            'Live map',
            'A made-up region. Each dot is a vehicle, reported by a simulated phone through the real API. The table beside it says the same in words.',
            mapBox,
            stamp,
          ),
          box(
            'Real-time events',
            'Delivered by Socket.IO to this dispatcher, from a pg_notify sent inside the transaction that caused them.',
            feedHead,
            feed,
          ),
        ),
        h(
          'div',
          {},
          box(
            'Phones',
            'Five simulated phones sign in and drive. Pick one and misbehave.',
            phones,
            h('label', { for: 'f-driver' }, 'Phone'),
            driverSel,
            h(
              'div',
              { class: 'row' },
              order('offline', 'Go offline'),
              order('resume', 'Resume', { variant: 'primary' }),
              order('dead', 'Kill signal'),
            ),
            h(
              'div',
              { class: 'row' },
              order('stopped', 'Stop the vehicle'),
              order('jitter', 'Jitter at the edge'),
              order('bad_clock', 'Wrong clock'),
              order('teleport', 'Jump to the end'),
              order('drive', 'Drive on'),
            ),
            h(
              'div',
              { class: 'row' },
              button(
                'New trip',
                async () => {
                  const r = await fieldCommand('/api/lab/trips/replan', { driver_email: driverSel.value });
                  if (!r.ok)
                    throw new Error(
                      r.data?.error?.message || 'Could not plan a trip (the last one must be finished).',
                    );
                  toast('A new trip is planned; the phone picks it up.');
                  await refresh();
                },
                { small: true, ic: 'route' },
              ),
            ),
          ),
          box(
            'Alerts',
            'Opened by the evaluator the worker runs every five seconds in this demo. Silence counts after the threshold below.',
            alerts,
            h('p', { class: 'hint', id: 'f-thresholds' }, ''),
            h(
              'div',
              { class: 'row' },
              button(
                'Run the evaluator',
                async () => {
                  const r = await fieldCommand('/api/lab/evaluate', undefined);
                  evalOut.replaceChildren(out(r.data));
                  await refresh();
                },
                { small: true, ic: 'refresh' },
              ),
            ),
            evalOut,
          ),
        ),
      ),
    );

    const tick = poll(
      panel,
      async () => {
        await refresh();
        const t = model.thresholds;
        if (t)
          panel.querySelector('#f-thresholds').textContent =
            `Thresholds in this demo: no signal after ${t.no_signal_minutes} min, long stop after ${t.long_stop_minutes} min, arrival radius confirmed by ${t.arrival_confirmations} fixes, fixes worse than ${t.accuracy_limit_m} m ignored.`;
      },
      2000,
    );
    try {
      const socket = await openSocket(PRAIRIE);
      for (const name of EVENT_NAMES) socket.on(name, (p) => pushEvent(name, p));
      socket.on('connect_error', () => {
        feedHead.textContent = 'The socket could not connect; the table still refreshes by polling.';
      });
    } catch (e) {
      feedHead.textContent = e instanceof Error ? e.message : String(e);
    }
    await tick();
    // Move the markers between polls as position events arrive, without redrawing more than ~4 times a second.
    const redraw = setInterval(() => {
      if (!panel.isConnected) return clearInterval(redraw);
      if (!panel.hidden && model.places.length) mapBox.innerHTML = mapSvg(model);
      return undefined;
    }, 250);
  }

  /* ---------------------------------------------------------------- ingest: send batches as a driver */
  function ingestTab(panel, k) {
    const { h, button, badge, box, out, kv } = k;
    const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
    const fix = (msAgo, lat, lng, extra = {}) => ({
      lat,
      lng,
      captured_at: at(msAgo),
      accuracy_m: 10,
      speed_kmh: 40,
      ...extra,
    });
    const MIN = 60_000;
    const SAMPLES = {
      one: { label: 'A normal reading', build: () => [fix(0, 38.4, -98.12)] },
      mixed: {
        label: 'Mixed batch: 3 good, 3 bad',
        build: () => [
          fix(10 * MIN, 38.401, -98.12),
          fix(9 * MIN, 38.402, -98.12),
          fix(8 * MIN, 38.403, -98.12),
          fix(7 * MIN, 0, 0), // no GPS fix: null island
          fix(-2 * 60 * MIN, 38.404, -98.12), // two hours ahead: a wrong clock
          fix(30 * 24 * 60 * MIN, 38.405, -98.12), // older than the retention window
        ],
      },
      older: { label: 'An older reading than the last one', build: () => [fix(60 * MIN, 38.4, -98.119)] },
      tunnel: {
        label: 'Two hours in a tunnel (300 readings)',
        build: () =>
          Array.from({ length: 300 }, (_, i) =>
            fix((300 - i) * 24_000, 38.4 + i * 0.00012, -98.12, { source: 'batch' }),
          ),
      },
      impostor: {
        label: 'A reading that names another driver',
        build: () => [{ ...fix(0, 38.4, -98.12), driver_id: '00000000-0000-4000-8000-000000000000' }],
      },
    };

    const sample = h(
      'select',
      { id: 'i-sample' },
      Object.entries(SAMPLES).map(([key, s]) => h('option', { value: key }, s.label)),
    );
    const body = h('textarea', { id: 'i-body', spellcheck: 'false', rows: 12 });
    const result = h('div', {});
    const where = h('div', {});
    const load = () => {
      body.value = JSON.stringify({ pings: SAMPLES[sample.value].build() }, null, 1);
    };
    sample.addEventListener('change', load);
    load();

    async function send(label) {
      let parsed;
      try {
        parsed = JSON.parse(body.value);
      } catch {
        throw new Error('That is not valid JSON.');
      }
      const r = await as(MANUAL_DRIVER, '/v1/pings', { method: 'POST', body: parsed });
      const d = r.data;
      const lines = r.ok
        ? [
            badge(`accepted ${d.accepted}`, d.accepted ? 'ok' : ''),
            badge(`duplicates ${d.duplicates}`, d.duplicates ? 'warn' : ''),
            badge(`rejected ${d.rejected.length}`, d.rejected.length ? 'bad' : ''),
            badge(`position updated: ${d.position_updated}`, d.position_updated ? 'ok' : ''),
          ]
        : [badge(String(r.status), 'bad'), d?.error?.message || 'Refused'];
      result.prepend(
        h(
          'div',
          { class: 'box arrive' },
          h('h3', {}, label, ` · ${r.ms} ms`),
          h('div', { class: 'row' }, lines),
          out(d),
        ),
      );
      await show();
    }

    async function show() {
      const [snapshot, state] = await Promise.all([as(PRAIRIE, '/v1/fleet/snapshot'), labState()]);
      const me = snapshot.ok ? snapshot.data.vehicles.find((v) => v.driver_name === 'Devon Park') : null;
      where.replaceChildren(
        kv({
          'last position': me?.position
            ? `${me.position.lat.toFixed(5)}, ${me.position.lng.toFixed(5)}`
            : 'none yet',
          'captured at': me?.position ? me.position.captured_at : '—',
        }),
        h(
          'p',
          { class: 'hint' },
          `Stored readings per day partition (all drivers): ${state.partitions.map((p) => `${p.partition.replace('pings_', '')}: ${p.pings}`).join(' · ') || 'none yet'}`,
        ),
      );
    }

    panel.append(
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          box(
            'Compose a batch',
            'Sent as Devon Park, the one driver with no simulated phone. The body is editable; “Send again” sends exactly the same bytes.',
            h('label', { for: 'i-sample' }, 'Start from'),
            sample,
            h('label', { for: 'i-body' }, 'Body (POST /v1/pings)'),
            body,
            h(
              'div',
              { class: 'row' },
              button('Send batch', () => send('Sent'), { variant: 'primary', ic: 'arrow' }),
              button('Send again', () => send('Sent again'), { ic: 'refresh' }),
              button('New readings', async () => load(), { small: true }),
            ),
            h(
              'p',
              { class: 'hint' },
              'The server decides per reading. One with no GPS fix, a clock in the future or a date older than retention is refused by itself; the others in the same batch are kept. A reading it has already stored counts as a duplicate, and one older than the latest never moves the vehicle.',
            ),
          ),
          where,
        ),
        h('div', {}, box('Responses', null, result)),
      ),
    );
    return show();
  }

  /* ---------------------------------------------------------------- queue: capacity counts people */
  async function queueTab(panel, k) {
    const { h, button, badge, box, out, kv, toast } = k;
    const catalog = await as(PRAIRIE, '/v1/fleet/catalog');
    const unit = catalog.ok ? catalog.data.units[0] : null;
    if (!unit) {
      panel.append(box('No unit', 'The demonstration fleet has no mobile unit. Use “Start over”.'));
      return;
    }
    let counter = 0;
    const person = h('input', { id: 'q-person', type: 'text', value: 'guest-a' });
    const service = h(
      'select',
      { id: 'q-service' },
      ['loading', 'unloading', 'inspection'].map((s) => h('option', { value: s }, s)),
    );
    const priority = h('input', { id: 'q-priority', type: 'checkbox' });
    const board = h('div', {});
    const last = h('div', {});
    const stateKind = (s) =>
      ({ waiting: '', called: 'warn', serving: 'ok', finished: 'ok', cancelled: 'bad' })[s] || '';

    async function post(path, body) {
      const r = await as(PRAIRIE, path, { method: 'POST', body });
      last.replaceChildren(
        h(
          'div',
          { class: 'arrive' },
          badge(String(r.status), r.ok ? 'ok' : 'bad'),
          ' ',
          h('code', {}, `POST ${path.replace(/[0-9a-f-]{36}/g, (id) => short(id))}`),
          out(r.data),
        ),
      );
      await refresh();
      return r;
    }
    const act = (label, path, ticket, variant = 'secondary') =>
      button(label, () => post(path.replace(':id', ticket.id)), { small: true, variant });

    async function refresh() {
      const r = await as(PRAIRIE, `/v1/units/${unit.id}/board`);
      if (!r.ok) throw new Error('Could not read the board.');
      const d = r.data;
      board.replaceChildren(
        kv({
          unit: `${d.unit.name} (capacity ${d.unit.capacity ?? 'not set'})`,
          'people on board': d.on_board,
          'free places': d.free_places ?? '—',
          warning: d.warning || 'none',
        }),
        d.tickets.length
          ? h(
              'ul',
              { class: 'trace' },
              d.tickets.map((t) =>
                h(
                  'li',
                  {},
                  h('strong', {}, t.person_ref),
                  badge(t.status, stateKind(t.status)),
                  h('code', {}, t.service),
                  t.priority ? badge('priority', 'warn') : null,
                  t.status === 'waiting' ? act('Call', '/v1/tickets/:id/call', t, 'primary') : null,
                  t.status === 'called' ? act('Serve', '/v1/tickets/:id/serve', t, 'primary') : null,
                  t.status === 'serving' ? act('Finish', '/v1/tickets/:id/finish', t, 'primary') : null,
                  ['waiting', 'called', 'serving'].includes(t.status)
                    ? act('Cancel', '/v1/tickets/:id/cancel', t)
                    : null,
                ),
              ),
            )
          : h('p', { class: 'hint' }, 'The queue is empty. Add some people.'),
      );
    }

    const join = async (ref, svc, prio) => {
      const r = await as(PRAIRIE, `/v1/units/${unit.id}/tickets`, {
        method: 'POST',
        body: { person_ref: ref, service: svc, priority: prio },
      });
      if (!r.ok) throw new Error(r.data?.error?.message || `Refused (${r.status})`);
    };

    panel.append(
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          box(
            '1 · Add people',
            `${unit.name} holds ${unit.capacity} people. Capacity counts people, not tickets: someone with two services takes one place.`,
            h('label', { for: 'q-person' }, 'Person'),
            person,
            h('label', { for: 'q-service' }, 'Service'),
            service,
            h(
              'div',
              { class: 'row' },
              h('label', { class: 'check' }, priority, ' priority'),
              button(
                'Add',
                async () => {
                  await join(person.value, service.value, priority.checked);
                  await refresh();
                },
                { variant: 'primary', ic: 'arrow' },
              ),
              button(
                'Add 5 people',
                async () => {
                  for (let i = 0; i < 5; i += 1) {
                    counter += 1;
                    await join(`guest-${counter}`, 'loading', false);
                  }
                  await refresh();
                  toast('Five people are waiting.');
                },
                { small: true, ic: 'users' },
              ),
            ),
          ),
          box(
            '2 · Call them',
            'Both ways of calling go through one admission rule, with the unit row locked while it decides.',
            h(
              'div',
              { class: 'row' },
              button('Call next 1', () => post(`/v1/units/${unit.id}/call-next`, { count: 1 }), {
                small: true,
              }),
              button('Call next 5', () => post(`/v1/units/${unit.id}/call-next`, { count: 5 }), {
                small: true,
                variant: 'primary',
              }),
            ),
            last,
          ),
        ),
        h(
          'div',
          {},
          box(
            'The board',
            'Read from the server every two seconds.',
            board,
            h('div', { class: 'row' }, button('Refresh', refresh, { small: true, ic: 'refresh' })),
          ),
        ),
      ),
    );
    poll(panel, refresh, 2000);
    await refresh();
  }

  /* ---------------------------------------------------------------- router: a dependency you do not own */
  async function routerTab(panel, k) {
    const { h, button, badge, box, out, kv } = k;
    const status = h('div', {});
    const etas = h('div', {});
    const MODES = [
      ['ok', 'Healthy again', 'primary'],
      ['down', 'Down', 'secondary'],
      ['slow', 'Slow', 'secondary'],
      ['hostile_geometry', 'Hostile geometry', 'secondary'],
      ['absurd_distance', 'Absurd distance', 'secondary'],
      ['huge_body', 'Huge body', 'secondary'],
    ];

    async function ask() {
      const [snapshot, state, field] = await Promise.all([
        as(PRAIRIE, '/v1/fleet/snapshot'),
        labState(),
        window.Kit.api('/api/lab/field', { auth: false }),
      ]);
      const breaker = state.router?.breaker || 'unknown';
      status.replaceChildren(
        kv({
          'router stand-in mode': field.ok ? field.data.router.mode : '—',
          'requests it received': field.ok ? field.data.router.requests : '—',
          'circuit breaker': h('span', {}, badge(breaker, breaker === 'closed' ? 'ok' : 'bad')),
          'cached answers': state.router?.cached ?? '—',
        }),
      );
      etas.replaceChildren(
        snapshot.ok
          ? h(
              'ul',
              { class: 'trace' },
              snapshot.data.vehicles
                .filter((v) => v.eta)
                .map((v) =>
                  h(
                    'li',
                    {},
                    h('strong', {}, v.vehicle),
                    `${v.eta.minutes} min · ${v.eta.distanceKm} km`,
                    badge(v.eta.source, v.eta.source === 'road' ? 'ok' : 'warn'),
                    badge(v.eta.speedBasis, ''),
                  ),
                ),
            )
          : out(snapshot.data),
      );
    }
    const setMode = (mode, label, variant) =>
      button(
        label,
        async () => {
          const r = await fieldCommand('/api/lab/field/router', { mode });
          if (!r.ok) throw new Error(r.data?.error?.message || 'The stand-in did not answer.');
          await ask();
        },
        { small: true, variant },
      );

    panel.append(
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          box(
            '1 · Make the router misbehave',
            'The road router is a stand-in the lab controls. The application treats it as it would a real one: with a timeout, a body cap, geometry checks, a cache and a circuit breaker.',
            h(
              'div',
              { class: 'row' },
              MODES.map(([mode, label, variant]) => setMode(mode, label, variant)),
            ),
            h(
              'p',
              { class: 'hint' },
              'Down fails at once. Slow answers after fifteen seconds, longer than the timeout. Hostile geometry returns a route whose vertex is thousands of kilometres away. Absurd distance claims forty times the straight-line distance. Huge body streams without end.',
            ),
          ),
          box(
            '2 · Ask for an ETA',
            'Each press reads the fleet snapshot, which asks the router for every moving vehicle.',
            h('div', { class: 'row' }, button('Ask for an ETA', ask, { variant: 'primary', ic: 'route' })),
            etas,
          ),
        ),
        h('div', {}, box('What the application knows', null, status)),
      ),
    );
    poll(panel, ask, 3000);
    await ask();
  }

  /* ---------------------------------------------------------------- boundaries: fleets, tokens, sockets, links */
  async function boundariesTab(panel, k) {
    const { h, button, badge, box, out, kv } = k;
    const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const results = h('ul', { class: 'trace' });
    const note = (label, status, text) =>
      results.prepend(
        h(
          'li',
          { class: 'arrive' },
          badge(String(status), typeof status === 'number' && status < 400 ? 'ok' : 'bad'),
          h('strong', {}, label),
          h('span', {}, text),
        ),
      );
    const errText = (d) =>
      d && d.error
        ? `${d.error.code}: ${d.error.message}`
        : typeof d === 'string'
          ? d.slice(0, 60)
          : JSON.stringify(d).slice(0, 80);

    const [mine, theirs] = await Promise.all([as(PRAIRIE, '/v1/trips'), as(HARBOR, '/v1/trips')]);
    const prairieTrip = mine.ok && mine.data[0] ? mine.data[0].id : null;
    const harborTrip = theirs.ok && theirs.data[0] ? theirs.data[0].id : null;
    if (!prairieTrip || !harborTrip) {
      panel.append(
        box('Nothing to probe', 'Both demonstration fleets need a trip. Use “Start over” to recreate them.'),
      );
      return;
    }

    /* ---- the other fleet */
    const peek = async () => {
      const real = await as(HARBOR, `/v1/trips/${prairieTrip}`);
      const never = await as(HARBOR, '/v1/trips/00000000-0000-4000-8000-000000000000');
      note('Another fleet’s trip', real.status, errText(real.data));
      note('A trip that never existed', never.status, errText(never.data));
      note(
        'Compared',
        real.status === never.status && errText(real.data) === errText(never.data) ? 200 : 500,
        real.status === never.status && errText(real.data) === errText(never.data)
          ? 'identical: the other fleet’s trip is indistinguishable from one that does not exist'
          : 'DIFFERENT: the answer reveals that the trip exists',
      );
    };

    /* ---- tokens */
    const noToken = async () => {
      const r = await window.Kit.api('/v1/fleet/snapshot', { auth: false });
      note('No token', r.status, errText(r.data));
    };
    const forged = async (alg) => {
      const real = await tokenFor(PRAIRIE);
      const claims = JSON.parse(atob(real.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const head = b64({ alg: alg === 'none' ? 'none' : 'HS256', typ: 'JWT' });
      const payload = b64({ ...claims, exp: claims.exp + 86_400 });
      let sig = '';
      if (alg !== 'none') {
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode('not-the-key-not-the-key-not-the-key'),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const raw = new Uint8Array(
          await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${payload}`)),
        );
        sig = btoa(String.fromCharCode(...raw))
          .replace(/=+$/, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      }
      const r = await window.Kit.api('/v1/fleet/snapshot', {
        auth: false,
        headers: { authorization: `Bearer ${head}.${payload}.${sig}` },
      });
      note(
        alg === 'none' ? 'Token with alg “none”' : 'Token signed with another key',
        r.status,
        errText(r.data),
      );
    };
    const driverReads = async () => {
      const r = await as(MANUAL_DRIVER, '/v1/fleet/snapshot');
      note('A driver reading the fleet', r.status, errText(r.data));
    };

    /* ---- sockets */
    const noSocket = async () => {
      const socket = await openSocket(null, { token: '', reconnect: false });
      await new Promise((resolve) => {
        let finished = false;
        const done = (status, text) => {
          if (finished) return;
          finished = true;
          note('Socket without a token', status, text);
          socket.close();
          resolve();
        };
        socket.on('error', (e) =>
          done(403, `the server answered ${e && e.code ? e.code : 'an error'} and closed it`),
        );
        socket.on('connect_error', (e) => done(403, `refused while connecting: ${e.message}`));
        socket.on('disconnect', () => done(403, 'closed by the server'));
        setTimeout(() => done(500, 'nothing happened in four seconds: the socket was NOT refused'), 4000);
      });
    };
    const otherFleetSocket = async () => {
      const [mineDrivers, theirDrivers] = await Promise.all([
        as(PRAIRIE, '/v1/fleet/catalog'),
        as(HARBOR, '/v1/fleet/catalog'),
      ]);
      const prairieIds = new Set(mineDrivers.data.drivers.map((d) => d.id));
      const harborIds = new Set(theirDrivers.data.drivers.map((d) => d.id));
      const socket = await openSocket(HARBOR, { reconnect: false });
      let own = 0;
      let foreign = 0;
      socket.on('position', (p) => {
        if (harborIds.has(p.driver_id)) own += 1;
        else if (prairieIds.has(p.driver_id)) foreign += 1;
      });
      note('Listening as the other fleet’s dispatcher…', 200, 'counting position events for six seconds');
      await new Promise((r) => setTimeout(r, 6000));
      socket.close();
      note(
        'Positions heard',
        foreign === 0 && own > 0 ? 200 : 500,
        `${own} from its own drivers, ${foreign} from this fleet. The room is taken from the verified token; the gateway has no message that lets a client name another room.`,
      );
    };

    /* ---- the signed sheet link */
    let link = null;
    const countdown = h('span', { class: 'countdown' }, '—');
    const linkView = h('div', {});
    const tick = setInterval(() => {
      if (!panel.isConnected) return clearInterval(tick);
      if (link) {
        // The server refuses a link only once its clock is PAST the expiry second, so say "expired" only then.
        const left = (link.expires - Date.now()) / 1000;
        countdown.textContent = left < -1.5 ? 'expired' : `${Math.max(0, Math.ceil(left))} s left`;
      }
      return undefined;
    }, 500);
    const mint = async () => {
      const r = await as(PRAIRIE, `/v1/trips/${prairieTrip}/sheet-link`, { method: 'POST' });
      if (!r.ok) throw new Error(errText(r.data));
      link = { url: r.data.url, expires: Date.parse(r.data.expires_at) };
      linkView.replaceChildren(out(link.url));
    };
    const open = async (url, label) => {
      const res = await fetch(url);
      const bytes = new Uint8Array(await res.clone().arrayBuffer());
      const isPdf =
        res.headers.get('content-type') === 'application/pdf' &&
        String.fromCharCode(...bytes.slice(0, 4)) === '%PDF';
      note(
        label,
        res.status,
        isPdf ? `a PDF of ${bytes.length} bytes` : errText(await res.json().catch(() => '')),
      );
    };
    const tamper = async (kind) => {
      if (!link) await mint();
      const u = new URL(link.url, location.href);
      if (kind === 'expiry') u.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 86_400));
      if (kind === 'trip') u.pathname = u.pathname.replace(prairieTrip, harborTrip);
      if (kind === 'signature') {
        const s = u.searchParams.get('sig');
        u.searchParams.set('sig', (s[0] === 'A' ? 'B' : 'A') + s.slice(1));
      }
      await open(
        u.pathname + u.search,
        {
          expiry: 'Extended expiry',
          trip: 'Pointed at the other fleet’s trip',
          signature: 'One character of the signature changed',
        }[kind],
      );
    };

    panel.append(
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          box(
            '1 · The other fleet',
            'Signed in as Harbor Couriers, ask for a trip that belongs to Prairie Freight.',
            h(
              'div',
              { class: 'row' },
              button('Read the other fleet’s trip', peek, { variant: 'primary', ic: 'eye' }),
            ),
          ),
          box(
            '2 · Credentials',
            'Every one of these must be refused, and with the same kind of answer.',
            h(
              'div',
              { class: 'row' },
              button('No token', noToken, { small: true }),
              button('Token with alg “none”', () => forged('none'), { small: true }),
              button('Token signed with another key', () => forged('hs256'), { small: true }),
              button('A driver reading the fleet', driverReads, { small: true }),
            ),
          ),
          box(
            '3 · Sockets',
            'The room a socket joins comes from the verified token.',
            h(
              'div',
              { class: 'row' },
              button('Connect a socket without a token', noSocket, { small: true }),
              button('Listen as the other fleet', otherFleetSocket, { small: true }),
            ),
          ),
          box(
            '4 · The signed sheet link',
            'A link is a bearer credential: HMAC over the trip, the fleet and the expiry, valid for 30 seconds in this demo.',
            h(
              'div',
              { class: 'row' },
              button('Mint a sheet link', mint, { small: true, variant: 'primary', ic: 'doc' }),
              button(
                'Open the link',
                async () => {
                  if (!link) await mint();
                  await open(link.url, 'The genuine link');
                },
                { small: true },
              ),
              countdown,
            ),
            linkView,
            h(
              'div',
              { class: 'row' },
              button('Extend the expiry', () => tamper('expiry'), { small: true }),
              button('Point it at the other fleet’s trip', () => tamper('trip'), { small: true }),
              button('Change one signature character', () => tamper('signature'), { small: true }),
            ),
            kv({
              'a valid link after it expires': '410 LINK_EXPIRED',
              'any altered link': '403 INVALID_LINK',
            }),
          ),
        ),
        h('div', {}, box('Responses', null, results)),
      ),
    );
  }

  window.LAB = {
    eyebrow: 'The lab',
    title: 'Try to break it.',
    text: 'Five ways to push on the system, each backed by tests. A fleet runs on this machine against invented data: five simulated phones drive a made-up region through the real API.',
    reset: {
      label: 'Start over',
      hint: 'Both demonstration fleets re-created, history dropped, the router healthy, the phones signed in again.',
      done: 'Back to a clean slate.',
      run: async ({ api }) => {
        closeSockets();
        tokens.clear();
        const r = await api('/api/lab/reset', { method: 'POST', auth: false });
        if (!r.ok) throw new Error('Could not reset the lab.');
      },
    },
    tabs: [
      { id: 'map', label: 'Field', icon: 'pin', render: (p, k) => fieldTab(p, k) },
      { id: 'ingest', label: 'Ingest', icon: 'database', render: (p, k) => ingestTab(p, k) },
      { id: 'queue', label: 'Queue', icon: 'users', render: (p, k) => queueTab(p, k) },
      { id: 'router', label: 'Router', icon: 'route', render: (p, k) => routerTab(p, k) },
      { id: 'boundaries', label: 'Boundaries', icon: 'shield', render: (p, k) => boundariesTab(p, k) },
    ],
  };
})();
