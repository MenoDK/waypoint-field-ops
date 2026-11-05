# 0004. Alerts are state, reconciled on a schedule; arrival needs proof

Status: Accepted

## Context

"This phone has been silent for 15 minutes" is the absence of an event. Code that runs when a position arrives can never
see it. And the same alert must not be raised again every time somebody looks: an operator who gets the same notification
every 30 seconds stops reading notifications.

Arrival has the opposite problem. It is decided from positions, and one position near the boundary is as likely to be GPS
jitter as a vehicle. Two requests can also observe "arrived" at the same moment and each want to announce it.

## Decision

- **An alert is a row, not a message.** `alerts` holds at most one `open` alert per `(driver, kind)`: a partial unique
  index, so the invariant is the database's and not a convention. Kinds: `no_signal`, `long_stop`, `arriving_soon`.
- **A pure function says what should be open.** `desiredAlerts(state, now, limits)` has no I/O. The evaluator reads the
  active trips, calls it, and **reconciles**: opens what is desired and missing (`ON CONFLICT DO NOTHING` on the partial
  index), clears what is open and no longer desired. Looking again changes nothing. Opening and clearing publish an event in
  the same transaction (ADR 0007).
- **The worker runs it on a schedule** (`WORKER_TICK_SECONDS`), together with housekeeping (ADR 0003). Both jobs are
  idempotent, so there is no leader election: one worker or three give the same result, and a test runs three evaluators at
  the same instant and requires exactly one alert. A tick that is still running when the next is due is skipped, not stacked.
  After each good tick the worker rewrites a heartbeat file; the container health check reads its age.
- **A trip that has not started cannot be late.** Only `IN_TRANSIT` trips are evaluated; accepting a trip is not departing.
- **Arrival needs the last `ARRIVAL_CONFIRMATIONS` (default 2) _accurate_ fixes of the running trip to be inside the
  destination's radius.** Vague fixes (ADR 0002) do not count and do not break a streak of good ones; a drive-by followed by
  leaving is not an arrival.
- **The stamp is a compare-and-set.** `UPDATE trips SET arrived_at = … WHERE id = $1 AND arrived_at IS NULL AND status =
'IN_TRANSIT' RETURNING id`: however many transactions saw the condition, one gets a row back and only that one announces.
  Requests from the same driver already queue at the live-position row, so over HTTP the guard cannot be seen from outside;
  a test therefore holds the trip row, lets two transactions both decide "arrived", and counts the announcements.

## Rejected alternatives

- **Notify on every evaluation.** Simple; unreadable within the hour.
- **Raise alerts from the ingest request.** Cannot express silence, and ties the cost of rules to the hottest path.
- **Remember what was already announced in memory.** Lost on restart, and wrong the moment there are two workers.
- **One fix inside the radius is an arrival.** Jitter at the edge of the circle would announce arrival, then un-announce it.
- **Let the driver tap "I have arrived".** A person forgets, or taps early. The phone reports where it is; the server decides.
- **A leader-elected singleton worker.** Machinery to protect jobs that are already safe to repeat.

## Consequences

- (+) The alert list is an honest picture of the present: it has what is true now, and its history shows when it began and ended.
- (+) Adding a rule is a case in one pure function and a table of tests, with no change to the plumbing.
- (−) Latency is up to one tick. The demo compresses the thresholds (one minute of silence) so the behaviour can be watched.
- (−) Three workers do three evaluations per tick for the same result. The cost is redundant reads, not wrong answers; add a
  lock only if it ever shows up in a measurement.
