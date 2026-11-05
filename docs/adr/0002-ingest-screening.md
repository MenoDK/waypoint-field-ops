# 0002. Screen every reading, keep the good ones, name the bad ones

Status: Accepted

## Context

A phone that spent two hours in a tunnel uploads 300 readings at once. Some of them are wrong in ways a schema cannot
express: a GPS that never got a fix reports (0, 0), a phone with a bad clock stamps the future, a forgotten device uploads
readings from last month. If the batch is judged as a whole, one bad coordinate costs the other 299 good ones, and the phone
either retries forever or drops the lot.

The location itself is also personal data. What is stored, for how long and from whom is decided at the door, not later.

## Decision

- **Meaning is checked per reading, shape per request.** The request body is validated as a whole (a list, at most
  `PING_MAX_BATCH` items, no field the server does not know). Then `screenPing` judges each reading and returns a reason:
  `bad_coordinate` (out of range, not a number, or null island), `future` (further ahead than
  `PING_MAX_FUTURE_SKEW_SECONDS`, a wrong clock) or `too_old` (older than `PING_RETENTION_DAYS`, which would land in a
  partition that no longer exists).
- **Partial acceptance.** The good readings are stored; the response lists `{index, reason}` for every bad one, so the phone
  can log exactly which reading was wrong. The call is `200` unless the _request_ is malformed.
- **Identity comes from the token, never from the body.** A reading that names a driver is a `400` for the whole request:
  there is no field to forge, and a test proves nothing was written for the driver it named.
- **A vague fix is stored but never believed.** `accuracy_m` above `ACCURACY_LIMIT_M` stays in the history (it is honest
  about what the phone said) but is excluded from arrival, speed and stop decisions.
- Every threshold is configuration with a bound, validated at start-up. None is a number inside a function.

## Rejected alternatives

- **Reject the whole batch when any reading is bad.** Simple, and it punishes the phone that did the right thing by
  buffering offline. Rejected: it turns one wrong coordinate into 299 lost readings.
- **Silently drop the bad readings.** The phone is told it succeeded and nobody can tell a broken GPS from a quiet driver.
- **Trust the device clock.** A phone set to next year would pin a vehicle in the future and make every "newest wins" rule
  wrong from then on.
- **Discard inaccurate fixes entirely.** A 900 m fix is still evidence that the phone was alive and roughly where. Dropping it
  would turn a poor-signal stretch into a false "no signal" alert.
- **Accept `driver_id` in the body "for convenience".** One missing check away from writing positions for someone else.

## Consequences

- (+) Each rule is a pure function with its own unit test, and the mixed-batch behaviour is visible in the lab's Ingest tab.
- (+) A rejected reading never reaches the database, so a bad batch costs no write.
- (−) The caller must read `rejected` to know what was kept; a bare `200` does not mean "everything was stored".
- (−) "Too old" is judged against the server clock, so a server with a wrong clock misjudges every phone. The health check
  does not detect that; the clock is an operational dependency.
