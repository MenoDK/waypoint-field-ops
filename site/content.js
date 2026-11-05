/* Content for the landing page and the lab. Everything the page says about behaviour is backed by a test; the output in
   the tour is recorded from the running application (test/transcripts.e2e-spec.ts) and a test fails if it drifts. */
window.SITE = {
  name: 'waypoint-field-ops',
  short: 'Waypoint',
  title: 'waypoint-field-ops · a fleet backend for phones that lose signal',
  logo: 'pin',
  repo: 'https://github.com/MenoDK/waypoint-field-ops',
  accent: {
    light: { fill: '#ef7d2d', ink: '#a8480f', on: '#2b1204', soft: '#fdeadb', onNavy: '#ffa862' },
    dark: { fill: '#f58a3c', ink: '#ffb27a', on: '#2b1204', soft: '#4a2a12', onNavy: '#ffa862' },
  },
  loading: {
    context: 'Fleet operations',
    title: 'Locating the fleet',
    text: 'Reading the last positions, the road router and the clock.',
    icon: 'pin',
    satellites: ['clock', 'route', 'alert'],
    foot: 'Local demo · simulated phones on this machine',
    sketch: 'M12 120C60 40 100 150 168 78S290 24 330 96',
  },
  lab: { href: 'lab.html', cta: 'Enter the lab' },

  hero: {
    eyebrow: 'Field operations · offline-tolerant, honest about what it knows',
    lead: 'Know where every vehicle is',
    soft: 'and how sure you are.',
    text: 'A fleet backend for phones that go through tunnels, send an hour of positions at once and sometimes have the wrong time. Readings are screened and stored once, ETAs say how they were made, silence raises an alert, and a queue never boards more people than the vehicle holds. Simulated phones drive a made-up region on your laptop.',
    primary: { label: 'Open the lab', href: 'lab.html' },
    secondary: { label: 'See how it works', href: '#tour', icon: 'layers' },
    pilot: 'Runs on your laptop · the phones and the road router are simulated, no accounts',
    proof: [
      { icon: 'database', a: 'Positions are stored once', b: 'however often they are sent' },
      { icon: 'flask', a: 'Every guarantee has a test', b: 'that tries to break it' },
    ],
    top: ['WAYPOINT', 'Positions you can defend.'],
    status: {
      icon: 'alert',
      small: 'Last alert',
      strong: 'No signal for 4 min. Opened by the worker, cleared by the next position.',
    },
    art: `<svg viewBox="0 50 500 620" role="img" aria-label="A map of four towns joined by roads, with a truck driving towards a destination ringed by its arrival radius. Below it, a phone without signal holds 214 readings in its buffer, and the server shows the last fix four minutes old, an open no-signal alert and an ETA of 12 minutes by road.">
      <g class="a-line"><path d="M0 120H500M0 240H500M0 360H500M0 480H500M0 600H500M100 30V700M250 30V700M400 30V700"/></g>
      <circle cx="250" cy="300" r="190" class="a-soft"/>

      <rect x="36" y="136" width="428" height="230" rx="20" class="a-body"/>
      <text x="58" y="164" class="a-text">REGION · LIVE</text>
      <path d="M84 322L196 232L316 232L416 322" class="a-line"/>
      <path d="M84 322L196 232L316 232" class="a-dash"/>
      <circle cx="84" cy="322" r="7" class="a-body"/>
      <circle cx="196" cy="232" r="7" class="a-body"/>
      <circle cx="316" cy="232" r="7" class="a-body"/>
      <circle cx="416" cy="322" r="7" class="a-body"/>
      <circle cx="316" cy="232" r="24" class="a-accent-s pulse"/>
      <circle cx="100" cy="308" r="2.5" class="a-accent"/>
      <circle cx="114" cy="296" r="2.5" class="a-accent"/>
      <circle cx="128" cy="284" r="2.5" class="a-accent"/>
      <circle cx="142" cy="272" r="2.5" class="a-accent"/>
      <circle cx="156" cy="260" r="2.5" class="a-accent"/>
      <circle cx="170" cy="248" r="2.5" class="a-accent"/>
      <g class="travel"><rect x="204" y="224" width="26" height="16" rx="4" class="a-accent"/><rect x="230" y="228" width="9" height="12" rx="3" class="a-accent"/></g>
      <g class="travel b"><rect x="204" y="224" width="26" height="16" rx="4" class="a-accent"/><rect x="230" y="228" width="9" height="12" rx="3" class="a-accent"/></g>
      <text x="84" y="348" text-anchor="middle" class="a-text-s">Harbor Yard</text>
      <text x="196" y="262" text-anchor="middle" class="a-text-s">Fairview</text>
      <text x="316" y="276" text-anchor="middle" class="a-text-s">Elm Crossing</text>
      <text x="416" y="348" text-anchor="middle" class="a-text-s">Cedar Point</text>

      <rect x="36" y="384" width="200" height="118" rx="18" class="a-body"/>
      <text x="56" y="412" class="a-text">PHONE · NO SIGNAL</text>
      <rect x="56" y="428" width="160" height="10" rx="5" class="a-line"/>
      <rect x="56" y="428" width="118" height="10" rx="5" class="a-accent"/>
      <text x="56" y="466" class="a-text-s">214 readings waiting</text>
      <text x="56" y="486" class="a-text-s">sent whole, on reconnect</text>

      <path d="M240 443H260" class="a-dash"/>

      <rect x="264" y="384" width="200" height="118" rx="18" class="a-body"/>
      <text x="284" y="412" class="a-text">SERVER</text>
      <circle cx="290" cy="436" r="5" class="a-accent"/>
      <text x="304" y="440" class="a-text-s">last fix 4 min ago</text>
      <circle cx="290" cy="460" r="5" class="a-bad-f pulse"/>
      <text x="304" y="464" class="a-text-s">NO SIGNAL · alert open</text>
      <circle cx="290" cy="484" r="5" class="a-accent"/>
      <text x="304" y="488" class="a-text-s">ETA 12 min · by road</text>
    </svg>`,
  },

  principles: {
    lead: ['Built for', 'the dead zones.'],
    items: [
      ['database', 'Stores once'],
      ['route', 'Names its method'],
      ['alert', 'Alerts on silence'],
      ['users', 'Counts people'],
    ],
  },

  tour: {
    eyebrow: 'A tour of the whole thing',
    title: ['Five things that go wrong', 'out on the road.'],
    text: 'Pick a tab. The output below is recorded from the running application with fictional data; a test fails if it ever stops being true.',
    tag: 'Recorded output',
    tabs: [
      {
        id: 'ingest',
        label: 'Ingest',
        icon: 'database',
        title: 'An hour in a tunnel arrives as one batch, and is stored once.',
        text: 'One reading with no GPS fix or a wrong clock is refused by itself; the good ones in the same batch are kept. Sending the batch again changes nothing, and an old reading never moves the vehicle backwards.',
        lab: 'lab.html#ingest',
        transcript: (window.TRANSCRIPTS || {}).ingest || '',
      },
      {
        id: 'arrival',
        label: 'Arrival',
        icon: 'pin',
        title: 'Arriving takes two good fixes, and is written once.',
        text: 'One fix inside the radius can be GPS jitter. A fix that admits its own error margin is too wide to count. The arrival is stamped with a conditional update, so two simultaneous batches cannot both claim it.',
        lab: 'lab.html#map',
        transcript: (window.TRANSCRIPTS || {}).arrival || '',
      },
      {
        id: 'alerts',
        label: 'Alerts',
        icon: 'alert',
        title: 'Silence raises an alert. A position clears it.',
        text: 'Alerts are state, not events: a partial unique index allows one open alert per vehicle and kind, and a scheduled evaluator reconciles them. Running it twice, or on three workers, gives the same answer.',
        lab: 'lab.html#map',
        transcript: (window.TRANSCRIPTS || {}).alerts || '',
      },
      {
        id: 'queue',
        label: 'Queue',
        icon: 'users',
        title: 'The unit never boards more people than it holds.',
        text: 'Capacity counts people. One rule decides how many may be called, for “call the next five” and for “call this one”, and the unit row is locked while it does.',
        lab: 'lab.html#queue',
        transcript: (window.TRANSCRIPTS || {}).queue || '',
      },
      {
        id: 'boundaries',
        label: 'Boundaries',
        icon: 'shield',
        title: 'Another fleet’s trip does not exist. A bad router is not believed.',
        text: 'Everything is scoped by the fleet in the token, so another fleet’s id answers 404, not 403. A hostile router response is refused and the ETA says it fell back to a straight line.',
        lab: 'lab.html#boundaries',
        transcript: (window.TRANSCRIPTS || {}).boundaries || '',
      },
    ],
    modulesTitle: 'Everything in the box.',
    modulesNote: 'Each one has a test file and a place in the lab',
    modules: [
      [
        'database',
        'Append-only history',
        'Daily partitions, a primary key of driver and capture time, ON CONFLICT DO NOTHING, and retention by dropping a partition instead of deleting rows.',
      ],
      [
        'pin',
        'Latest-position upsert',
        'A newer capture wins, an older one is kept in history but never moves the vehicle, and the time it last really moved is tracked apart.',
      ],
      [
        'route',
        'ETA with a method',
        'Road or straight line, measured or default speed, and the answer says which. A circuit breaker and a cache sit in front of the router.',
      ],
      [
        'alert',
        'Alerts as state',
        'No signal, long stop, arriving soon. A scheduled evaluator reconciles them against the facts; a partial unique index keeps one open each.',
      ],
      [
        'users',
        'Capacity-aware queue',
        'One admission rule for both ways of calling, FOR UPDATE on the unit, and a warning when people on board exceed the ceiling.',
      ],
      [
        'wave',
        'Real time through the database',
        'pg_notify inside the transaction, a dedicated LISTEN connection that reconnects, and rooms taken from the verified token, never from a message.',
      ],
    ],
    transparency: {
      strong: 'Honest about the demo.',
      text: 'The phones and the road router are simulated programs that talk to the real API over HTTP; nothing here has run against real devices or a real routing engine. The region is made up. The limitations list in the README is complete.',
    },
  },

  challenges: {
    eyebrow: 'The hard parts',
    title: ['Go on,', 'try to break it.'],
    text: 'These are the seven things that are easy to claim and hard to get right. Each has a recipe, what you should see, and a button that opens the lab on that exact tab.',
    items: [
      {
        label: 'Go through a tunnel',
        icon: 'wave',
        access: 'Lab · Field',
        title: 'Take a phone offline, keep it driving, then bring it back.',
        text: 'Phones lose signal. The server must not lose the hour.',
        steps: [
          'In <code>Field</code>, pick a driver and press “Go offline”.',
          'Wait twenty seconds: the marker freezes while the phone keeps driving and buffering.',
          'Press “Resume” and watch the events feed.',
        ],
        expect:
          'The phone sends its buffer in chunks marked <code>source: batch</code>. Every reading is accepted once, none is duplicated, and the vehicle’s trail has no gap.',
        lab: 'lab.html#map',
      },
      {
        label: 'Send a bad batch',
        icon: 'alert',
        access: 'Lab · Ingest',
        title: 'Mix good readings with a null island, a future clock and an old one.',
        text: 'One bad reading must not cost the rest.',
        steps: [
          'In <code>Ingest</code>, choose “Mixed batch: 3 good, 3 bad” and press “Send batch”.',
          'Press it again.',
          'Choose “An older reading than the last one” and send it.',
        ],
        expect:
          'The first answer accepts three and rejects three with their reasons (<code>bad_coordinate</code>, <code>future</code>, <code>too_old</code>). The repeat accepts none and counts three <code>duplicates</code>. The old reading is stored but <code>position_updated</code> stays false.',
        lab: 'lab.html#ingest',
      },
      {
        label: 'Stand on the line',
        icon: 'pin',
        access: 'Lab · Field',
        title: 'Make a phone jitter at the edge of the destination.',
        text: 'Arriving is a decision, not a coordinate.',
        steps: [
          'In <code>Field</code>, pick a driver whose trip is under way and press “Jitter at the edge”.',
          'Watch the trip: the phone parks 350 m short and its readings alternate inside and outside the radius.',
          'After a minute, press “Drive on”.',
        ],
        expect:
          'While the readings alternate the trip stays <code>IN_TRANSIT</code>, because arrival needs two consecutive accurate fixes inside. After “Drive on” it arrives once, and <code>trip.arrived</code> appears a single time in the feed.',
        lab: 'lab.html#map',
      },
      {
        label: 'Go quiet',
        icon: 'clock',
        access: 'Lab · Field',
        title: 'Kill a phone’s signal and wait for the alert.',
        text: 'Nobody reports that they are not reporting.',
        steps: [
          'In <code>Field</code>, press “Kill signal” on a driver.',
          'Wait for the demo threshold (one minute) and press “Run the evaluator”. Press it again.',
          'Press “Resume” on that phone and run the evaluator once more.',
        ],
        expect:
          'One <code>no_signal</code> alert opens (the second run opens nothing new), the marker turns grey, and after the phone reports again the alert is <code>cleared</code>, with the time it was open.',
        lab: 'lab.html#map',
      },
      {
        label: 'Overbook the van',
        icon: 'users',
        access: 'Lab · Queue',
        title: 'Call more people than the unit holds, two different ways.',
        text: 'A capacity rule that only one path obeys is not a rule.',
        steps: [
          'In <code>Queue</code>, add five people to the mobile unit (capacity 3).',
          'Press “Call next 5”.',
          'Press “Call” on a waiting ticket as well.',
        ],
        expect:
          'Three are called and two keep waiting. Calling a single ticket by hand is refused with the same reason, because both go through one admission rule.',
        lab: 'lab.html#queue',
      },
      {
        label: 'Break the router',
        icon: 'route',
        access: 'Lab · Router',
        title: 'Make the road router lie, stall and disappear.',
        text: 'A dependency you do not own is an input, not a fact.',
        steps: [
          'In <code>Router</code>, press “Hostile geometry”, then “Ask for an ETA”.',
          'Press “Down”, ask two or three times, and read the breaker state.',
          'Press “Healthy again” and ask once more.',
        ],
        expect:
          'Each bad answer is refused and the ETA says <code>straight_line</code>. After four failures the breaker is <code>open</code> and the router is not called at all. “Healthy again” closes it, and the ETA is by <code>road</code> again.',
        lab: 'lab.html#router',
      },
      {
        label: 'Peek into another fleet',
        icon: 'eye',
        access: 'Lab · Boundaries',
        title: 'Ask one fleet for another fleet’s trip, socket and sheet.',
        text: 'Isolation that is checked can be forgotten. Isolation that is structural cannot.',
        steps: [
          'In <code>Boundaries</code>, press “Read the other fleet’s trip” and “Connect a socket without a token”.',
          'Press “Tamper with the sheet link” for each of its three variants.',
          'Press “Mint a sheet link”, open it, wait until the countdown says expired (30 s) and open it again.',
        ],
        expect:
          'The foreign trip answers 404, exactly as one that never existed. The socket is cut. Every tampered link gets the same <code>403</code>. The genuine link opens a PDF until it expires and then answers <code>410</code>: only a link that was really signed is told that it expired.',
        lab: 'lab.html#boundaries',
      },
    ],
  },

  run: {
    eyebrow: 'Run it in a minute',
    title: ['One command.', 'A fleet on localhost.'],
    text: 'You need Docker. There are no API keys, no accounts to create and nothing leaves your machine.',
    steps: [
      ['terminal', 'Clone', 'git clone, then cd into the folder.'],
      [
        'play',
        'Start',
        'make demo builds the image, migrates the database and starts the API, the worker and the simulated field, health-gated.',
      ],
      [
        'globe',
        'Open',
        'http://localhost:8400 is this page. Press “Enter the lab”: the vehicles are already moving.',
      ],
      ['flask', 'Break it', 'Use the hard parts above, or run make e2e for the browser suite.'],
    ],
    terminal: {
      title: 'bash',
      lines: [
        '# 1. get the code',
        'git clone https://github.com/MenoDK/waypoint-field-ops.git',
        'cd waypoint-field-ops',
        '# 2. start PostgreSQL/PostGIS, the API, the worker and the simulated field',
        'make demo',
        '# 3. open http://localhost:8400 and press “Enter the lab”',
        '# optional: the browser tests against the same stack',
        'make e2e',
      ],
    },
  },

  under: {
    eyebrow: 'Under the hood',
    title: ['A small surface,', 'serious edges.'],
    text: 'The interesting code is short on purpose. The decisions behind it are written down with the alternatives that lost.',
    stackTitle: 'What it is built with',
    stack: [
      {
        group: 'Service',
        items: ['Node 22 · TypeScript (strict)', 'NestJS 11', 'zod 4', 'no ORM: SQL you can read'],
      },
      {
        group: 'Data',
        items: [
          'PostgreSQL 17 + PostGIS 3.5',
          'Daily-partitioned history',
          'Partial unique indexes',
          'LISTEN / NOTIFY',
        ],
      },
      {
        group: 'Real time',
        items: ['Socket.IO rooms', 'Rooms from the verified token', 'Reconnecting listener'],
      },
      {
        group: 'Security',
        items: [
          'scrypt · pinned HS256 JWT',
          'HMAC-signed, expiring links',
          'Least-privilege database role',
          'Strict CSP on the demo',
        ],
      },
      {
        group: 'Quality',
        items: [
          'Jest on a real PostGIS',
          'Mutation checks on the invariants',
          'Playwright + axe',
          'ESLint · tsc --strict',
        ],
      },
      {
        group: 'Delivery',
        items: ['Multi-stage Dockerfile, non-root', 'Compose, health-gated', 'GitHub Actions · gitleaks'],
      },
    ],
    proofTitle: 'What is measured, and the records behind it',
    numbers: [
      ['366', 'tests: 215 unit and 151 against a real PostGIS with the application listening'],
      ['22/22', 'broken-on-purpose rules caught by a test, none left alive'],
      ['10', 'decision records, each with rejected alternatives'],
      ['0', 'errors under tsc --strict'],
    ],
    decisions: [
      [
        'Screen each reading, not the request',
        'ADR 0002: why one bad coordinate must not cost the other 299.',
        'docs/adr/0002-ingest-screening.md',
      ],
      [
        'History you can only add to',
        'ADR 0003: partitions, idempotent writes and retention without DELETE.',
        'docs/adr/0003-append-only-history.md',
      ],
      [
        'Alerts are state',
        'ADR 0004: why a reconciler beats an event handler.',
        'docs/adr/0004-alerts-are-state.md',
      ],
      [
        'One admission rule',
        'ADR 0005: how capacity stays true under concurrent calls.',
        'docs/adr/0005-queue-capacity.md',
      ],
      [
        'An ETA that names its method',
        'ADR 0006: honest fallbacks and a router that is not trusted.',
        'docs/adr/0006-eta-and-router.md',
      ],
      [
        'Real time through the database',
        'ADR 0007: pg_notify in the transaction and rooms from the token.',
        'docs/adr/0007-realtime.md',
      ],
      [
        'A lab that cannot reach production',
        'ADR 0008: three layers keep the switches where they belong.',
        'docs/adr/0008-the-lab.md',
      ],
      [
        'Trips by table, links by signature',
        'ADR 0009: compare-and-set transitions and links that carry their own permission.',
        'docs/adr/0009-trips-and-signed-links.md',
      ],
      [
        'Boundaries by construction',
        'ADR 0010: the fleet from the token, deny by default, a small database role.',
        'docs/adr/0010-boundaries.md',
      ],
    ],
    measuredOn: 'Measured on 2026-11-05. Counts come from the commands in the README, not from memory.',
    future: [
      ['A real routing engine', 'behind the same guarded adapter, with its own traffic data.'],
      ['Push for drivers', 'instead of polling, through the same rooms.'],
      ['Per-fleet retention', 'because how long positions may be kept is a contract term.'],
    ],
  },

  about: {
    why: 'Waypoint is the field-operations side of my work: phones that cannot be trusted to be online, to have the right time or to send things once, feeding screens people make decisions from. The ideas come from systems I have built and operated; the code in this repository is written fresh and tested.',
  },

  faq: [
    [
      'Is there a real sign-up?',
      'No, on purpose. The demo has two invented fleets with a dispatcher and drivers each; the lab signs you in as any of them. Real sign-in (scrypt, rate limits, pinned JWT) is in the API and tested.',
    ],
    [
      'Why PostGIS and not just latitude and longitude columns?',
      'Distances, radii and trails are geography problems. PostGIS gets them right on a sphere, indexes them, and keeps the geofence checks in one place.',
    ],
    [
      'Why partition the history by day?',
      'Because the cheapest way to forget personal data on schedule is to drop a partition. The application role cannot even DELETE from the history; a controlled function drops partitions.',
    ],
    [
      'What if two workers evaluate alerts at once?',
      'Nothing breaks. The evaluator compares facts with the open alerts and a partial unique index stops a duplicate, so one worker or three give the same result.',
    ],
    [
      'Can the lab mode reach production?',
      'No. The configuration refuses LAB_MODE and a demo password when NODE_ENV is production, a test pins that, and the lab routes answer 404 unless the lab is on, and refuse any Host that is not local.',
    ],
    [
      'Is it production-ready?',
      'It is built and tested to that standard: strict types, real-database tests, mutation checks. It has not carried real traffic, and what it lacks is listed in the README limitations.',
    ],
  ],

  closing: {
    eyebrow: 'Your turn',
    title: ['Try to make the server', 'believe a position it should not.'],
    button: 'Open the lab',
    fine: 'Local only · fictional data · nothing is sent anywhere',
  },
};
