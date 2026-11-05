# 0006. An ETA says how it was computed; the router is an outsider

Status: Accepted

## Context

An arrival time is only as good as the distance and speed behind it. A straight line is always available and always too
short; a road router gives a real distance but is a separate service that can be down, slow, wrong or hostile. A precise-looking
number that is secretly a guess is worse than an honest rough one, because someone will plan around it.

If the router's answer is drawn on a map or turned into minutes without question, a bad reply becomes a line in the wrong
country, a ten-megabyte body in memory, or an ETA off by a factor of five.

## Decision

- **Every ETA carries its method.** `source` is `road` or `straight_line`; `speedBasis` is `measured` (the driver's own
  recent accurate fixes), `default` (not enough history) or `router` (the router's trip time). The screen shows which. A
  straight line is a lower bound and is labelled as one.
- **One door to the router**: `RoutingService.route()`. It returns a road route or `null`, never throws and never waits
  longer than `ROUTER_TIMEOUT_MS`. On `null` the caller falls back to the straight line **and says so**.
- **The reply is checked before it is believed** (pure functions, each with tests):
  - the body is read with a byte limit and abandoned as soon as it is exceeded;
  - the geometry must be well-formed, at most 20 000 vertices, and every point inside the box of the requested points
    plus a margin (one stray point makes the whole answer suspect);
  - the road distance must be plausible next to the straight line: never shorter (a hair of tolerance), rarely more than a few
    times longer. A zero-length road is believed only when the vehicle is standing on the destination.
- **A circuit breaker** (`closed` → `open` after 4 failures in a row → `half_open` lets exactly one probe through). Failures
  and untrustworthy answers count; "there is no road between these points" does not, because the service is fine and the
  question has no answer. State is per instance and time is injected, so each behaviour is an ordinary test.
- **A small LRU cache** keyed by the points rounded to about 11 m, for five minutes: the road between two positions a few
  metres apart has not changed, and the router is asked once instead of once per refresh.
- **The router URL is the operator's, not a request's**, but a slip is still caught: a public host over plain `http://` is
  refused at start-up (coordinates must not cross the internet in clear); `localhost`, private ranges and bare service names
  are allowed.
- With no router configured, ETAs are straight-line from the start and the product says so. The router is an enhancement.

## Rejected alternatives

- **Always use the straight line.** Honest, and too optimistic to plan with where roads wind.
- **Call a hosted routing API directly.** A third party would receive every vehicle position, for a feature whose
  value does not require it. The router is meant to run beside the API.
- **Trust the router's reply.** Fast to build and exactly the bug the stand-in's "hostile geometry" lever demonstrates.
- **Retry with backoff inside the request.** Turns a slow router into a slow dashboard. The breaker fails fast instead.
- **Cache with a fixed key per exact coordinate.** Never hits: GPS readings never repeat to the last decimal.

## Consequences

- (+) The worst a bad router can do is make the ETA less precise, and the response says that it did.
- (+) The lab can break the router on demand (down, slow, hostile) and the screen shows the fallback, the breaker and the label.
- (−) Real routing behaviour (turn restrictions, live traffic) is the router's business; the integration was tested against a
  stand-in that speaks the same API, not against a real instance.
- (−) The cache and the breaker are per process. Three API replicas learn that the router is down separately.
