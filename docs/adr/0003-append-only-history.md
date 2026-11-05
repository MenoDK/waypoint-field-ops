# 0003. History is append-only and idempotent; retention drops partitions

Status: Accepted

## Context

Phones retry. A request that timed out may have been stored; the same readings can arrive twice, or arrive at the same
instant in two requests. Batches also arrive out of order: the one that was stuck in a tunnel lands after a newer one.

Two questions then need an answer that does not depend on who got there first: "what happened" (the history) and "where is
everyone now" (the live position). And because positions are personal data, history must also be able to _end_ cheaply and
reliably.

## Decision

- **The key is the idempotency.** `pings` has the primary key `(driver_id, captured_at)` and the insert is
  `ON CONFLICT DO NOTHING`. The database decides which copy won; there is no check-then-insert in application code to race.
  The response counts `accepted` and `duplicates`, so a replay is visible and harmless.
- **One statement per batch**, readings sent as parallel arrays to `unnest`. Each reading is attributed to the trip that
  covered its **capture** time, not to whatever trip is running when the batch finally arrives.
- **Readings go to the database oldest first.** Two overlapping batches (a retry that carries a few more readings) then take
  their row locks in the same order and queue behind each other; in opposite orders each would wait for the other and
  PostgreSQL would have to kill one with a deadlock, a `500` for a valid request. A unit test checks the order that is
  actually sent, because a race test would depend on timing.
- **The live position is a separate row** (`vehicle_positions`, one per driver) upserted with
  `WHERE EXCLUDED.captured_at > vehicle_positions.captured_at`: the newer capture wins, so a late batch cannot drag a pin
  backwards, and the map never scans history. `last_moved_at` advances even when the pin does not, so "stopped for 30
  minutes" is a subtraction.
- **Daily range partitions** on `captured_at`. The worker keeps the retention window behind and a few days ahead created
  (`ensure_ping_partitions`). **Retention drops whole partitions** (`drop_ping_partitions_before`): instant, no dead rows,
  no vacuum, nothing to forget to batch.
- **The application cannot erase history.** The runtime role has `SELECT, INSERT` on `pings` and nothing else. The only
  thing it can do to old data is call the two narrow `SECURITY DEFINER` functions (search path pinned), which drop only
  `pings_YYYYMMDD` partitions that ended before a cutoff.
- Positions of drivers silent for 24 hours leave the live table: a last-known location is still a location.

## Rejected alternatives

- **`ON CONFLICT DO UPDATE`.** Makes a replay overwrite the stored reading, so history is no longer what the phone said first.
  A mutant that does exactly this is caught by the suite.
- **Check, then insert, in application code.** Two requests both see "not there" and both write; the primary key would reject
  one with an error instead of a count.
- **One big table and a nightly `DELETE`.** Millions of dead rows, vacuum pressure and a window in which retention is
  not enforced. Dropping a partition has none of these.
- **TimescaleDB or another time-series store.** A new dependency to run and secure, for a volume that plain partitioning
  handles. The decision to revisit is a measured one: when a single day's partition no longer fits comfortably in memory.
- **Make the application role the table owner so it can run DDL itself.** One SQL injection from `DROP TABLE`.

## Consequences

- (+) A phone can retry forever without fear; the count in the response is the proof.
- (+) Retention is a metadata operation, enforced by the database and testable (`maintenance.e2e-spec.ts`).
- (−) A reading must fall inside an existing partition. Screening (ADR 0002) refuses readings outside the window, and the
  worker creates the next days' partitions ahead of time. If the worker is down for longer than that lead, ingest would
  start failing, so `/health/ready` goes red when the newest partition is today's, hours before midnight does it.
- (−) Partitions are per UTC day, so retention is whole days: a 7-day window keeps between 7 and 8 days of data.
