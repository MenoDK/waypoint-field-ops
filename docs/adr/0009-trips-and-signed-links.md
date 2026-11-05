# 0009. Trips move by a table and a compare-and-set; documents travel as signed links

Status: Accepted

## Context

A trip is the unit everything else hangs on: positions are attributed to it, arrival is decided for it, alerts only look at
the ones that have started. Two dispatchers can cancel it while the driver accepts it, and ten taps on "accept" can arrive at
once from a phone with a bad connection. Separately, a driver sometimes needs to show or send the trip sheet to someone who
has no account: a gate guard, a customer.

## Decision

- **The whole lifecycle is one table**: `TRANSITIONS` maps each action (`accept`, `start`, `complete`, `cancel`) to the
  states it may leave, the state it enters and the role allowed to do it. A move that is not in the table is a `409` that names
  where the trip actually is. Nothing else decides who may do what to a trip.
- **The table is enforced where the write happens**: `UPDATE trips SET status = <to> … WHERE id = $1 AND status = <from>`. If no
  row comes back, someone else got there first. Ten simultaneous accepts, or ten simultaneous cancels, produce exactly one
  winner and nine clear `409`s.
- **What cannot be a rule in code is a constraint in the database**: an end odometer must exceed the start; the schedule cannot
  arrive before it leaves; a driver has at most one active trip; a vehicle has at most one moving trip, even when two drivers
  share it. The service reports these as named errors, but the database is what refuses.
- **Notes append safely**: five notes written at once all survive (the append is a single statement, not read-modify-write).
- **The trip sheet is a PDF opened through a link that carries its own permission:**
  `/v1/trips/<id>/sheet.pdf?exp=<unix seconds>&sig=<mac>`. The signature is an HMAC-SHA-256 over a versioned string made of
  the trip, **the fleet that owns it** and the expiry, under a key only the server holds. So the link cannot be pointed at
  another trip, cannot have its expiry extended, and is worthless once expired.
- **Verification is ordered on purpose**:
  1. the shape of `exp` and `sig` is checked first;
  2. the signature must be the _canonical_ base64url spelling (32 bytes leave spare bits in the last character, and a lenient
     decoder would read several different strings as the same MAC);
  3. the MAC is compared in constant time **before** the clock is read, so a forged link that is also expired reads as forged
     (`403 INVALID_LINK`), not as "expired";
  4. only then `410 LINK_EXPIRED` or the document.
- **An unknown trip reads like a bad signature**, so the endpoint does not tell a stranger which trip ids exist. Only the fleet
  that owns a trip can be handed a link for it.
- The link is **not single-use**: anyone who holds it can open it until `exp`. That is why the lifetime is short
  (`SIGNED_URL_TTL_SECONDS`, 30 s to one hour, default five minutes) and why the sheet is a document a driver would show anyway.

## Rejected alternatives

- **Read the status, check it in code, then write.** Two requests both read `ACCEPTED` and both proceed.
- **Row locks for every trip action.** Correct, heavier than needed: a compare-and-set is one statement and yields the same single winner.
- **A bearer token in the URL.** Tokens are broader than "this document"; one that leaks in a log opens an account, not a page.
- **Expiry checked first.** Lets an attacker learn which expired links were once genuine.
- **A one-time-use link recorded in a table.** Writes on a read path and a table to clean, for a document of low sensitivity and
  a lifetime already measured in minutes.
- **Generate and store the PDF.** More to retain and to delete, for something cheap to render on demand from live data.

## Consequences

- (+) A state machine that is a table is a table of tests: the allowed and refused moves are enumerated, not sampled.
- (+) Altering a link in any way is the same answer, and the lab's Boundaries tab shows each alteration being refused.
- (−) A leaked link works until it expires. The residual risk is stated, not hidden, and bounded by the lifetime.
- (−) Rotating the signing key invalidates links in flight. Acceptable: they live minutes.
