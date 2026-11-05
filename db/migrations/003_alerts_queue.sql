-- Alerts: a state, not a stream of messages. At most one OPEN alert per driver and kind (a partial unique index), opened by
-- the evaluator when the condition becomes true and cleared when it stops being true. Re-evaluating every 30 seconds
-- therefore never repeats a notification.
CREATE TABLE alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id   uuid        NOT NULL,
  driver_id  uuid        NOT NULL,
  trip_id    uuid,
  kind       text        NOT NULL CHECK (kind IN ('no_signal', 'long_stop', 'arriving_soon')),
  status     text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared')),
  opened_at  timestamptz NOT NULL,
  cleared_at timestamptz,
  detail     jsonb       NOT NULL DEFAULT '{}',
  FOREIGN KEY (driver_id, fleet_id) REFERENCES users (id, fleet_id) ON DELETE CASCADE,
  CHECK ((status = 'open') = (cleared_at IS NULL))
);
CREATE UNIQUE INDEX alerts_one_open ON alerts (driver_id, kind) WHERE status = 'open';
CREATE INDEX alerts_fleet_time ON alerts (fleet_id, opened_at DESC);

-- The dispatch queue of a mobile service unit (a vehicle that visits a site and serves people one at a time, with a limited
-- number of places on board).
--
-- `capacity` counts PEOPLE on board, not tickets: one person with three services occupies one place until the last is done.
-- NULL means "no ceiling configured", which the planner reports instead of silently treating as unlimited.
CREATE TABLE units (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id uuid NOT NULL REFERENCES fleets (id),
  name     text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  capacity integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500),
  UNIQUE (fleet_id, name),
  UNIQUE (id, fleet_id)
);

CREATE TABLE tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     uuid        NOT NULL,
  fleet_id    uuid        NOT NULL,
  -- An opaque reference chosen by the caller. No name, no document number: the queue does not need to know who it is.
  person_ref  text        NOT NULL CHECK (person_ref ~ '^[A-Za-z0-9._-]{1,64}$'),
  service     text        NOT NULL CHECK (service ~ '^[a-z0-9_-]{1,40}$'),
  priority    boolean     NOT NULL DEFAULT false,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  status      text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'serving', 'done', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  called_at   timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (unit_id, fleet_id) REFERENCES units (id, fleet_id),
  UNIQUE (id, fleet_id)
);
-- Joining twice for the same service is the same ticket, not two.
CREATE UNIQUE INDEX tickets_one_open_service ON tickets (unit_id, person_ref, service)
  WHERE status IN ('waiting', 'called', 'serving');
CREATE INDEX tickets_waiting ON tickets (unit_id, priority DESC, seq) WHERE status = 'waiting';
CREATE INDEX tickets_on_board ON tickets (unit_id, person_ref) WHERE status IN ('called', 'serving');
