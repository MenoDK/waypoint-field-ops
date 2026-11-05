# Agent contract

Tool-neutral: what any engineer or coding agent needs to work here without asking.

## Commands

| Task                                                           | Command                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Install                                                        | `make install`                                                                                 |
| Lint, types, unit and database tests                           | `make check` (database tests need the throw-away PostGIS: `make db`)                           |
| Run the whole stack with the lab on                            | `make demo` (then http://localhost:8400); `make down` to stop, `make reset` to start from zero |
| Browser tests and accessibility scans                          | `make e2e` (Playwright in a container, against the real stack)                                 |
| Break each critical rule on purpose and confirm a test notices | `make mutate`                                                                                  |
| Re-record the landing page's sample output                     | `make transcripts`                                                                             |
| Documentation guards                                           | `docsguard check`                                                                              |

## Definition of done

1. A test covers it and fails without the change; a rule that matters gets an adversarial test (try to break it) and, if it is
   one of the critical rules, a mutant in `scripts/mutation-check.mjs`.
2. `make check` passes and you can quote its output; anything that touches SQL runs against a real PostGIS.
3. An ADR exists for any decision a newcomer would have to reverse-engineer, with the rejected alternatives.
4. `docs/HANDOFF.md` carries the numbers that were printed, not the ones that were expected.

## Boundaries

- Do not weaken a screening rule, the idempotent key, the fleet condition, the deny-by-default guard or the lab gate to make a
  test pass.
- Do not give the API or the worker the migration credential: only the one-shot `migrate` job holds it.
- Ask before adding a dependency or changing a public route, an error code or a configuration key.
- Anything outside the task goes into `docs/CHECKLIST.md`, not into this change.
- Never run `make mutate` while building images or editing `src/`, `site/` or the dev database: it rewrites sources in place.

## Reporting

Say what happened, not what was expected. A failed test, a skipped check or an unverified claim goes in the report as it is.
