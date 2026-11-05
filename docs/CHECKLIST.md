# Master checklist

_What_ and _when_. The _how_ belongs in a task's own notes, with `path:line` evidence; the _why_ in an ADR.

| #   | Item                                                                         | Status | Evidence                                                                           |
| --- | ---------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| 1   | Adopt decision records                                                       | done   | [ADR 0001](adr/0001-record-architecture-decisions.md)                              |
| 2   | Fill in `AGENTS.md` commands and describe the project in `CLAUDE.md`         | done   | `AGENTS.md`, `CLAUDE.md`                                                           |
| 3   | Ingest: per-reading screening, idempotent batches, newest-wins live pin      | done   | [ADR 0002](adr/0002-ingest-screening.md), `test/ingest.e2e-spec.ts`                |
| 4   | History: daily partitions, retention by dropping, least-privilege role       | done   | [ADR 0003](adr/0003-append-only-history.md), `test/maintenance.e2e-spec.ts`        |
| 5   | Alerts as state, arrival by confirmation, one conditional stamp              | done   | [ADR 0004](adr/0004-alerts-are-state.md), `test/alerts.e2e-spec.ts`                |
| 6   | Queue: one admission rule, one lock, capacity in people                      | done   | [ADR 0005](adr/0005-queue-capacity.md), `test/queue.e2e-spec.ts`                   |
| 7   | ETA with its method; guarded router, breaker, cache                          | done   | [ADR 0006](adr/0006-eta-and-router.md), `src/routing/*.spec.ts`                    |
| 8   | Real time: `pg_notify` in the transaction, token-derived rooms               | done   | [ADR 0007](adr/0007-realtime.md), `test/realtime.e2e-spec.ts`                      |
| 9   | Lab that cannot reach production                                             | done   | [ADR 0008](adr/0008-the-lab.md), `test/lab.e2e-spec.ts`                            |
| 10  | Trip state table, compare-and-set, signed links                              | done   | [ADR 0009](adr/0009-trips-and-signed-links.md), `test/trips.e2e-spec.ts`           |
| 11  | Boundaries: fleet from the token, `404` for foreign objects, deny by default | done   | [ADR 0010](adr/0010-boundaries.md), `test/security.e2e-spec.ts`                    |
| 12  | Mutation check: every critical rule guarded                                  | done   | `make mutate`: 22/22 caught (see HANDOFF for the run that proves it)               |
| 13  | Landing page and lab, 14 languages, strict CSP, WCAG A/AA                    | done   | `e2e/tests/` (landing, lab, 14 languages, axe), `site/i18n/`                       |
| 14  | CI on GitHub: all jobs green                                                 | done   | first run: all six jobs green (quality, database, mutation, docker, e2e, security) |
| 15  | Native-speaker review of the machine-quality translations (hi, bn, ur, ar)   | todo   | n/a                                                                                |
| 16  | Run the ingest against real devices and a real routing engine                | todo   | n/a: everything here is simulated, and the README says so                          |
| 17  | Per-fleet retention                                                          | todo   | README limitations                                                                 |
| 18  | Row-level security as a second tenancy layer                                 | todo   | [ADR 0010](adr/0010-boundaries.md), rejected as the _only_ guard, not as a layer   |
| 19  | Measure where `LISTEN/NOTIFY` stops being enough                             | todo   | [ADR 0007](adr/0007-realtime.md) consequences                                      |

Status is one of `todo`, `doing`, `done`, `dropped`. A `done` row names the commit, test or document that proves it.
A row is never deleted when it is dropped: it is marked `dropped` with the reason.
