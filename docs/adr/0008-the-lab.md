# 0008. A lab that runs the real services, and refuses to exist anywhere else

Status: Accepted

## Context

Most of what this system does well is invisible in a screenshot: a retry that stores nothing new, an alert that does not repeat,
a router that lies and is not believed. A reader should be able to clone the repository, run one command, and _provoke_ each of
those, with real phones, a real database and a real clock, rather than take a README's word for it.

A page that can reset the data and break the router is also exactly what must never be reachable on a real deployment.
Compose makes it easy to expose a port by accident, and browsers make it easy for an unrelated web page to fire requests at a
developer's `localhost`.

## Decision

- **The lab uses the real services.** Its levers ask the application to do what it does for any caller: run the alert
  evaluator now, run maintenance now, plan a trip, mint a token for a seeded demo user. It does not evaluate anything a visitor
  typed and has no code path of its own for the rules it demonstrates.
- **The field is a separate process**, `standin`, with its own port and no database access: simulated phones that sign in
  and send positions over the same HTTP API as a real device would, and a small road router that speaks the same protocol as the
  real one. Its controls (kill the signal, jitter at the edge, jump to the end, make the router lie or go down) are the only
  thing the lab forwards to it.
- **Three layers keep the lab where it belongs:**
  1. `LAB_MODE` is off by default and the configuration **refuses** to start with `LAB_MODE`, `DEMO_PASSWORD` or a weak
     password-hash cost when `NODE_ENV=production`. A wrong flag is a failed deploy, not a quiet exposure.
  2. `LabGate` answers `404` when the lab is off, `421` when the `Host` header is not `localhost` or a loopback address (a
     page that rebinds its own name to `127.0.0.1` is turned away), and `403` for a request that changes something and carries a
     foreign `Origin`.
  3. The Compose file publishes the port on `127.0.0.1` only.
- **Demo data is seeded under an advisory lock**, so several replicas booting together do not race to create the same fleets.
- **The lab has no sign-in screen.** It signs in as seeded demo users on the visitor's behalf; the "Boundaries" tab then uses
  forged, foreign and expired credentials to show what the real checks refuse.
- **Demonstration settings are shortened, never special-cased:** one minute of silence instead of fifteen, signed links
  that live thirty seconds. The code under test is the same; only the numbers in the environment differ.

## Rejected alternatives

- **Scripted screenshots and a recorded video.** Cannot be provoked, and cannot be wrong, so proves less.
- **A "demo mode" inside the services** that returns canned answers. The demonstration would no longer be of the system.
- **Ship the lab as a separate repository.** It would drift from the services it is meant to prove.
- **Protect the lab with a password.** A shared demo password is a credential to leak, and a login screen is friction for the one
  reader who only wanted to look.

## Consequences

- (+) Every claim in the README can be checked by clicking, and the same scenarios run as automated browser tests.
- (+) Because the lab is a client of the public API, anything it can do, a test can do: the recorded transcripts on the landing
  page are produced by replaying scenes against the real application.
- (−) The lab is code that exists only to be switched off. Its guard has its own tests, and a mutant that answers any `Host`
  is caught.
- (−) The phones and the router are stand-ins. Nothing here was run against a real device fleet or a real routing engine.
