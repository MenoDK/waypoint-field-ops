# Decision records

Each record states the problem, what was chosen, **what was rejected and why**, and the cost that was accepted.
Written _before_ the implementation, so it is a decision and not a justification.

| #                                             | Decision                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions                                                                 |
| [0002](0002-ingest-screening.md)              | Screen every reading, keep the good ones, name the bad ones                                   |
| [0003](0003-append-only-history.md)           | History is append-only and idempotent; retention drops partitions                             |
| [0004](0004-alerts-are-state.md)              | Alerts are state, reconciled on a schedule; arrival needs proof                               |
| [0005](0005-queue-capacity.md)                | One admission rule, one lock, capacity counted in people                                      |
| [0006](0006-eta-and-router.md)                | An ETA says how it was computed; the router is an outsider                                    |
| [0007](0007-realtime.md)                      | Announce from inside the transaction; rooms come from the token                               |
| [0008](0008-the-lab.md)                       | A lab that runs the real services, and refuses to exist anywhere else                         |
| [0009](0009-trips-and-signed-links.md)        | Trips move by a table and a compare-and-set; documents travel as signed links                 |
| [0010](0010-boundaries.md)                    | Boundaries: the fleet comes from the token, roles deny by default, the database role is small |

New record: copy the shape of `0001`, take the next number, add a row here, and bump the count in the map, all in one commit.
