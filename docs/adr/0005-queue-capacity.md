# 0005. One admission rule, one lock, capacity counted in people

Status: Accepted

## Context

A service unit is a vehicle that visits a site and serves people one at a time; only so many can be on board. A dispatcher
calls people from a waiting list, one at a time ("call this one") or many ("call the next five"), from several screens,
while other calls land at the same moment.

The usual failures are all quiet: a ceiling enforced on one button and not the other, a unit that fills with the first
customers' paperwork, and two simultaneous calls that each see one free place.

## Decision

- **Capacity counts people, not tickets.** One person with three services occupies one place until the last is done.
  `capacity` is a limit on distinct people with a ticket `called` or `serving`.
- **Someone already on board costs no place.** Their next service can be called even when the unit is full; otherwise they
  would hold a place that only frees when they finish services nobody is allowed to start.
- **There is exactly one admission rule**, `admission(state, person)`, a pure function used by "call next" and by "call this
  one". Two entry points never carry two copies of the ceiling. `planCalls` builds on it: at most one ticket per person,
  people already on board first, then newcomers by priority and arrival order until the places run out, each person's ticket
  chosen from the least loaded service.
- **The unit row is locked** (`SELECT … FOR UPDATE`) for the whole of a call, so two concurrent calls are serialised on the
  one thing they compete for. Tests fire ten "call next" and twelve "call this one" at once and require exactly three places
  filled; a mutant that removes the lock is caught.
- **No ceiling configured is reported, not assumed.** `capacity` may be `NULL`, and the plan then carries the warning
  `no_capacity_configured` instead of silently behaving as unlimited.
- **A ticket is an opaque reference.** `person_ref` is a short token chosen by the caller; no name, no document. The queue
  does not need to know who anybody is. Joining twice for the same service is one ticket (a partial unique index).
- Tickets called together come back in the order they were called, not in whatever order the database returns them.

## Rejected alternatives

- **Count tickets.** Fills the unit with the first people's second and third services.
- **Enforce capacity in the "call next" path and trust the UI for "call this one".** That is the bug.
- **Optimistic retry (compare the count, retry on conflict).** Correct, and noisier: it needs a retry loop where one short row
  lock is enough for a queue this size.
- **A database `CHECK` or trigger.** The limit depends on other rows; a trigger would hide the rule in a place the tests and
  the lab cannot narrate.
- **Store names to make the screen friendlier.** More personal data held for a convenience the caller can provide itself.

## Consequences

- (+) The rule is a pure function with a table of tests, and the lab shows a unit with three places refuse a fourth person
  with `UNIT_FULL`.
- (−) Calls on one unit are serialised. Intended: a unit is a physical thing with one dispatcher at a time. Different units do
  not contend.
- (−) `planCalls` is greedy by urgency and load. It is not an optimal scheduler and does not claim to be.
