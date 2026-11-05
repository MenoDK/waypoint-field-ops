# 0007. Announce from inside the transaction; rooms come from the token

Status: Accepted

## Context

A dispatcher's map should move when a phone reports, and an alert should appear when it opens, without the screen polling.
Two things go wrong with the obvious versions. An event emitted _before_ the commit announces something that then rolls back.
An event emitted _after_ it needs every code path to remember to do so, and a crash in between loses it. And on the
receiving side, a socket that can ask to "join" a room can ask to join someone else's.

## Decision

- **Publish inside the transaction, with `pg_notify`.** PostgreSQL delivers a notification only when the transaction commits
  and discards it on rollback, so nothing is announced that did not happen, and no code has to remember an "emit after
  commit" step. `publish(tx, message)` is the only way an event leaves, and it refuses a message that would not fit the 8 000
  byte limit instead of truncating it.
- **A listener fans out.** One dedicated connection per API process `LISTEN`s, validates each message against a schema, and
  hands it to the gateway. If that connection dies, it waits and opens a new one (a test kills the backend and checks that
  a different one is listening afterwards). Each process serves its own sockets, so adding API replicas needs no broker.
- **Delivery is best effort; the database is the truth.** A screen that reconnects reloads the snapshot. Nothing relies on
  having heard every event.
- **Rooms are derived from the verified token at connect time** and the gateway handles **no** `join` or `subscribe` message at
  all. A dispatcher joins their fleet's room; a driver joins only their own, so a phone never receives the rest of the fleet.
  A socket without a valid token is cut at once, and every socket is cut when its access token expires.
- **Event names live in one list** (`events.ts`), imported by the producers and the gateway. A contract test reads the
  browser code and the server code and fails if either side uses a name that is not on the list, or if a listed name is never
  emitted. The failure it prevents is a screen listening for an event nobody sends that still looks fine because something
  else happens to refresh it.

## Rejected alternatives

- **Emit after commit from application code.** Works until the path that forgot it; loses the event on a crash in between.
- **A message broker (Redis, NATS, Kafka).** The right answer at a scale this does not have, and one more thing to run, secure
  and keep consistent with the database. `LISTEN/NOTIFY` is enough for a fleet's worth of positions and alerts; the rate at
  which it stops being enough was not measured here. The listener is the seam where a broker would replace it.
- **Let the client send `join(fleetId)`, and check it.** Isolation by a check can be forgotten in one handler; isolation by
  construction has no handler to forget.
- **Poll.** Simple and wasteful; the map would lag by the polling period. (The lab still polls as a fallback when the socket
  cannot connect, and says so.)

## Consequences

- (+) Rolled-back work never reaches a screen, and a fleet's data cannot reach another fleet's sockets by any message a client
  can send.
- (+) A renamed event fails the build instead of silently dimming a screen.
- (−) A notification sent while a listener is down is gone. Acceptable because screens reload the snapshot; it would not be for
  a system whose consumers need every event.
- (−) `NOTIFY` is serialised at commit time inside PostgreSQL. It is not a good fit for very high event rates.
