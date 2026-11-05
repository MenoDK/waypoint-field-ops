#!/usr/bin/env node
/**
 * Breaks each critical rule on purpose, one at a time, and runs the test suite. A mutant that the suite does not notice means
 * a rule that nothing is guarding, so the script exits non-zero when any mutant survives (or cannot be applied).
 *
 *   node scripts/mutation-check.mjs [name fragment...]
 *
 * It needs the throw-away PostGIS from `make db` (the rules under test live in the SQL). Each source file is restored
 * afterwards, also on Ctrl-C. The recorded-transcripts test is left out of these runs: it would "catch" a change by noticing
 * that the landing page's text moved, which proves nothing about whether a behaviour test guards the rule.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** [name, file, exact text to find (must occur), replacement] */
const MUTANTS = [
  [
    'ingest: a replayed reading is stored again',
    'src/modules/pings/pings.service.ts',
    'ON CONFLICT (driver_id, captured_at) DO NOTHING',
    'ON CONFLICT (driver_id, captured_at) DO UPDATE SET source = EXCLUDED.source',
  ],
  [
    'ingest: readings are not sorted before the insert',
    'src/modules/pings/pings.service.ts',
    'accepted.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());',
    '',
  ],
  [
    'ingest: a clock in the future is believed',
    'src/modules/pings/screen.ts',
    "if (ageMs < -options.maxFutureSkewSeconds * 1000) return { ok: false, reason: 'future' };",
    '',
  ],
  [
    'ingest: a reading older than retention is stored',
    'src/modules/pings/screen.ts',
    "if (ageMs > options.retentionDays * 86_400_000) return { ok: false, reason: 'too_old' };",
    '',
  ],
  [
    'ingest: null island is a position',
    'src/geo/geo.ts',
    'return !(lat === 0 && lng === 0);',
    'return true;',
  ],
  [
    'position: an older reading moves the vehicle',
    'src/modules/pings/pings.service.ts',
    'WHERE EXCLUDED.captured_at > vehicle_positions.captured_at',
    '',
  ],
  [
    'arrival: a vague fix counts',
    'src/modules/pings/pings.service.ts',
    'AND (p.accuracy_m IS NULL OR p.accuracy_m <= $3)',
    'AND $3::int IS NOT NULL',
  ],
  [
    'arrival: one fix is enough',
    'src/modules/pings/geofence.ts',
    'fixes.slice(0, confirmations).every',
    'fixes.slice(0, 1).every',
  ],
  [
    'arrival: the stamp is not conditional',
    'src/modules/pings/pings.service.ts',
    "WHERE id = $1 AND arrived_at IS NULL AND status = 'IN_TRANSIT' RETURNING id",
    "WHERE id = $1 AND status = 'IN_TRANSIT' RETURNING id",
  ],
  [
    'alerts: a second evaluation opens a second alert',
    'src/modules/alerts/alerts.service.ts',
    "ON CONFLICT (driver_id, kind) WHERE status = 'open' DO NOTHING",
    "ON CONFLICT (driver_id, kind) WHERE status = 'open' DO UPDATE SET opened_at = EXCLUDED.opened_at",
  ],
  [
    'queue: the ceiling is ignored',
    'src/modules/queue/planner.ts',
    'if (state.onBoard.size >= state.capacity) {',
    'if (false as boolean) {',
  ],
  [
    'queue: the unit row is not locked',
    'src/modules/queue/queue.service.ts',
    "'SELECT capacity FROM units WHERE id = $1 AND fleet_id = $2 FOR UPDATE',",
    "'SELECT capacity FROM units WHERE id = $1 AND fleet_id = $2',",
  ],
  [
    'queue: called tickets come back in database order',
    'src/modules/queue/queue.service.ts',
    'rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));',
    '',
  ],
  [
    'isolation: another fleet’s trip is readable',
    'src/modules/trips/trips.service.ts',
    'WHERE id = $1 AND fleet_id = $2 AND ($3::uuid IS NULL OR driver_id = $3)',
    'WHERE id = $1 AND $2::uuid IS NOT NULL AND ($3::uuid IS NULL OR driver_id = $3)',
  ],
  [
    'isolation: an endpoint with no access policy is open',
    'src/common/guards.ts',
    "if (!allowed?.length) throw forbidden('NO_ACCESS_POLICY', 'This endpoint declares no access policy');",
    'if (!allowed?.length) return true;',
  ],
  [
    'links: an alias of the signature is accepted',
    'src/modules/trips/signed-url.ts',
    "if (given.toString('base64url') !== sig) return 'invalid';",
    '',
  ],
  [
    'links: expiry is judged before the signature',
    'src/modules/trips/signed-url.ts',
    "if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid';",
    "if (Number(exp) < nowSeconds) return 'expired';\n  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'invalid';",
  ],
  [
    'lab: any Host header is answered',
    'src/lab/lab.gate.ts',
    "if (!LOCAL_HOSTS.has(hostOf(request.headers.host ?? ''))) {",
    'if (false as boolean) {',
  ],
  [
    'router: the circuit breaker never opens',
    'src/routing/circuit-breaker.ts',
    'if (this.openedAt !== null || this.failures >= this.options.failuresToOpen) this.openedAt = this.now();',
    'if (this.openedAt !== null) this.openedAt = this.now();',
  ],
  [
    'router: hostile geometry is believed',
    'src/routing/guards.ts',
    'if (lng < west || lng > east || lat < south || lat > north) return null;',
    '',
  ],
  [
    'router: an absurd distance is believed',
    'src/routing/guards.ts',
    'return roadKm <= Math.max(straightKm * 6, straightKm + 2);',
    'return true;',
  ],
  [
    'screen: an event is renamed on one side only',
    'site/lab.js',
    "'trip.arrived',\n    'queue.updated',",
    "'trip.arrival',\n    'queue.updated',",
  ],
];

const filters = process.argv.slice(2);
const selected = MUTANTS.filter(([name]) => filters.length === 0 || filters.some((f) => name.includes(f)));
const originals = new Map();
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text);
  originals.clear();
};
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

const suite = () =>
  spawnSync('npx', ['jest', '--runInBand', '--bail', '--testPathIgnorePatterns=transcripts'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 280_000,
  });

// A suite that is already red would "catch" every mutant and prove nothing.
const baseline = suite();
if (baseline.status !== 0) {
  console.error(
    `The unmodified suite fails, so no mutant can be judged:\n${baseline.stdout}\n${baseline.stderr}`,
  );
  process.exit(2);
}
console.log('baseline: the unmodified suite passes\n');

const problems = [];
for (const [name, rel, find, replacement] of selected) {
  const file = new URL(`../${rel}`, import.meta.url).pathname;
  const source = readFileSync(file, 'utf8');
  if (!source.includes(find)) {
    console.log(`CANNOT APPLY  ${name}  (the code moved: update scripts/mutation-check.mjs)`);
    problems.push(name);
    continue;
  }
  originals.set(file, source);
  writeFileSync(file, source.replace(find, replacement));
  try {
    const run = suite();
    const output = `${run.stdout}\n${run.stderr}`;
    if (/error TS\d+/.test(output)) {
      // A mutant that does not compile is "caught" by the compiler, which says nothing about the tests.
      console.log(`CANNOT APPLY  ${name}  (the mutant does not compile: change the replacement)`);
      problems.push(name);
    } else {
      const caught = run.status !== 0;
      console.log(`${caught ? 'caught   ' : 'SURVIVED '} ${name}`);
      if (!caught) problems.push(name);
    }
  } finally {
    restore();
  }
}
console.log(
  `\n${selected.length - problems.length}/${selected.length} caught${problems.length ? `; not caught: ${problems.join('; ')}` : ''}`,
);
process.exit(problems.length ? 1 : 0);
