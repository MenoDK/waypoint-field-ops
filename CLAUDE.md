# waypoint-field-ops

The back end of a field-operations desk: phones report positions, dispatchers watch a live map, alerts open and clear by
themselves, a unit's queue never overbooks, and trip sheets leave as signed links. Node 22, TypeScript (strict), NestJS 11,
raw `pg` on PostgreSQL 17 + PostGIS, Socket.IO, zod. The constraint behind everything: **a phone is an unreliable witness**,
so the server screens, de-duplicates and decides; it never takes a client's word for where it is or who it is.

## Start here

- Map of every document: [docs/00-READ-FIRST.md](docs/00-READ-FIRST.md). Open a document only when the map says to.
- Resuming work: `docs/HANDOFF.md` first; rewrite it before you stop.
- Commands and definition of done: @AGENTS.md

## Layout

- `src/modules/`: `pings` (ingest, geofence), `trips` (state table, signed links, PDF), `alerts` (pure rules + evaluator),
  `queue` (pure planner + service), `fleet` (snapshot, ETA), `identity`, `maintenance`, `health`, `observability`.
- `src/routing/`: the only door to the road router (client, guards, circuit breaker, cache). `src/realtime/`: event list,
  `pg_notify` publisher, listener, gateway. `src/lab/`: lab mode. `src/standin/`: simulated phones and router.
- `src/main.ts` is the API, `src/worker.ts` the scheduler, `src/database/migrate-cli.ts` the one-shot migration job.
  `src/config/env.ts` is the only reader of the environment.
- `db/migrations/`: plain SQL, applied in order. `site/`: landing page and lab UI, plain JS and CSS, no build step.
- `test/` (real PostGIS), `e2e/` (Playwright + axe), `scripts/mutation-check.mjs` (breaks the rules on purpose).

## Rules that apply to every task

1. **Screen each reading; keep the good ones; name the bad ones.** ADR 0002.
2. **History is append-only; the key is the idempotency; rows go in oldest first.** ADR 0003.
3. **An alert is state reconciled on a schedule, never a message; the arrival stamp is a compare-and-set.** ADR 0004.
4. **Capacity has one admission rule and one lock.** ADR 0005.
5. **An ETA names its method; the router is never believed without checks.** ADR 0006.
6. **Publish events inside the transaction; rooms come from the token.** ADR 0007.
7. **Lab mode never reaches production.** The settings validator refuses it; do not add another way in. ADR 0008.
8. **Fleet and role come from the token; foreign objects are `404`; routes deny by default.** ADR 0010.
9. **Tests build their own secrets at run time** and use fictitious data only.
10. **Docs are code.** A new document is added to the map in the same commit; `docsguard check` must pass.

Advice versus enforcement: this file is advice. If `docsguard` is installed, `.claude/settings.json` turns the key rules
into hooks (destructive git is refused, and so are writes to secrets and keys).
