# 0010. Boundaries: the fleet comes from the token, roles deny by default, the database role is small

Status: Accepted

## Context

Several fleets share one deployment, and the data includes where people's vehicles are. The failures that matter are not
exotic: a handler that forgets to filter by fleet, a route that nobody put a role on, an error that confirms another
customer's id exists, a credential that can do more than the process needs.

Each of these is one forgotten line, so the design aims at making the line unnecessary.

## Decision

- **The caller's fleet and role come from a verified token and nowhere else.** Bodies and query strings have no field for
  them, and a request that tries is refused. Tokens are HS256 with the algorithm pinned, so `"alg": "none"` or another key
  never verifies. Access tokens are short-lived.
- **Every query that touches tenant data carries the fleet as a condition**, and the schema backs it: composite foreign keys
  `(id, fleet_id)` make it impossible to reference a driver, vehicle or place of another fleet from a trip or a ticket. A request
  that tries to plan a trip with another fleet's driver creates nothing.
- **Another fleet's object looks like one that does not exist.** Every read and write on a foreign trip, unit or ticket answers
  `404 NOT_FOUND`, never `403`. The lab asks for a foreign trip and for one that never existed and compares the status and
  the error text of the two answers.
- **Deny by default.** `RolesGuard` refuses any route that declares neither `@Public()` nor `@Roles(...)`, and a test walks every
  real route and fails the build if one declares nothing. The guard has its own unit tests, so the rule holds on the day a route
  is mounted in a way the walk does not see.
- **Sign-in says nothing it need not.** A wrong password and an unknown account answer in the same words; failures are limited
  per account and per address; passwords are scrypt-hashed with a cost the configuration refuses to lower in production.
- **The runtime database role is small.** The API and the worker connect as `app_user`: `SELECT, INSERT` on `pings`, ordinary
  DML on the other tables, `EXECUTE` on two narrow functions, nothing on the schema or the migration ledger. Schema changes
  run in a **one-shot `migrate` job** that is the only holder of the owner credential; it creates the role and sets its
  password, then exits. A compromised API process holds nothing that can alter or erase history.
- **Real-time rooms are derived from the token** (ADR 0007), and signed links bind the owning fleet (ADR 0009).
- **The container runs with what it needs and no more**: non-root, read-only root filesystem, no capabilities, no
  privilege escalation, a health check per long-running service.

## Rejected alternatives

- **Filter by fleet in one middleware.** A single place to get wrong for every handler, and it cannot cover raw SQL.
- **Postgres row-level security as the only guard.** Strong, and hides the rule from the code and tests that should narrate it; it
  is a candidate for a second layer, not a replacement for conditions that are visible in review.
- **`403` for a foreign object.** Honest and leaky: it confirms that the id exists.
- **Give the application the owner credential "for migrations".** One injection from `DROP TABLE`, and all of history with it.
- **Default-allow with an allow-list of public routes.** The opposite default, in which a forgotten annotation is a hole.

## Consequences

- (+) The checks are enumerated in tests (`security.e2e-spec.ts`) and demonstrable in the lab's Boundaries tab.
- (−) Every new query must remember its fleet condition. The composite keys and the isolation tests make forgetting loud, not impossible.
- (−) `app_user` can still read and write live data. The design limits what a compromise can _destroy_, not what it can _see_.
