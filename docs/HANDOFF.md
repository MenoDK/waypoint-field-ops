# Handoff

Updated: 2026-11-05

Rewrite this file at the end of every session. A fresh session must be able to resume from disk alone.

## 1. What is live

The whole system runs locally with `make demo` (Docker only): PostGIS, the API on `127.0.0.1:8400`, the worker, and the simulated field (phones and a road router) that drives two fictional fleets. The landing page is served by the API; the lab sits behind `LAB_MODE`.
Nothing is deployed anywhere. The repository is pushed private; the first CI run passed all six jobs, and later results are the badge in the README.

## 2. Where we stopped

Feature-complete: ingest, history, alerts, queue, ETA and router guard, real time, lab, trips and signed links, boundaries.
Ten decision records, 22 mutants, a landing page in 14 languages, screenshots and CI are all in place.
The open rows are in [CHECKLIST.md](CHECKLIST.md) and are things this repository cannot do alone (real devices, a real routing engine, a native review of four translations).

## 3. What the owner does now

- Read the first CI run on GitHub and fix anything that only fails there.
- Ask a native speaker to read the Hindi, Bengali, Urdu and Arabic overlays (`site/i18n/`); they are machine-quality.
- Decide whether to make the repository public (nothing in it names an origin project; `scripts/scan-all.sh` in the workspace is the check).

## 4. Deadlines

None.

## 5. What NOT to do

- Do not give the application role `DELETE` or `UPDATE` on `pings`; retention drops whole partitions through the `SECURITY DEFINER` functions ([ADR 0003](adr/0003-append-only-history.md)).
- Do not read a fleet, a room or a driver from a request body; they come from the verified token ([ADR 0010](adr/0010-boundaries.md)).
- Do not add a second admission rule to the queue; there is one function, called under `FOR UPDATE` ([ADR 0005](adr/0005-queue-capacity.md)).
- Do not turn arrival into a plain `UPDATE`; the `WHERE arrived_at IS NULL AND status = 'IN_TRANSIT'` guard is what stops two batches announcing it twice ([ADR 0004](adr/0004-alerts-are-state.md)).
- Do not edit source files, build images or touch the dev database while `make mutate` runs: it rewrites sources in place.
- Do not mark an item done without the output of the check that proves it.

## 6. Decisions

All in `docs/adr/`, each with the alternatives that were rejected:
[0002 ingest screening](adr/0002-ingest-screening.md), [0003 append-only history](adr/0003-append-only-history.md), [0004 alerts are state](adr/0004-alerts-are-state.md), [0005 queue capacity](adr/0005-queue-capacity.md), [0006 ETA and router](adr/0006-eta-and-router.md), [0007 real time](adr/0007-realtime.md), [0008 the lab](adr/0008-the-lab.md), [0009 trips and signed links](adr/0009-trips-and-signed-links.md), [0010 boundaries](adr/0010-boundaries.md). Start at [0001](adr/0001-record-architecture-decisions.md).

## 7. Learned, not in the code

- The first mutation run found three rules the tests did not guard: the oldest-first sort of readings (deadlock avoidance), the conditional arrival stamp, and deny-by-default for routes without a role policy. Each got a test; the second run caught 22 of 22.
- The arrival stamp cannot be observed through HTTP: requests from one driver already serialize on the live-position upsert. The test holds the trip row from the owner pool, waits until both transactions are blocked in `pg_stat_activity`, then releases.
- `pg_isready` in a Compose healthcheck has to use TCP (`-h 127.0.0.1`); the socket answers before the server accepts connections from other containers.
- Daily partitions follow the real date, not the test clock, so tests that need a partition create their data relative to today.

## 8. Suite state

Measured on 2026-11-05:

- Unit tests: 215. Tests against a real PostGIS with the application listening: 151. Total 366.
- Browser tests (`make e2e`): 48 passed, including 14 languages, right-to-left layouts and the accessibility scan. 4 more are the screenshot generators, skipped unless `SHOTS=1`.
- Mutation check: 22 of 22 caught.
- `tsc --strict`, ESLint and Prettier: 0 findings.
- Translations: 13 overlays at 100% coverage.
- `docsguard check`: see the last run in CI and in the README.
