-- Positions.
--
-- `pings` is the history: append-only and partitioned by day, so that retention is "drop a partition" (instant, no bloat,
-- no vacuum) instead of a nightly DELETE of millions of rows. The primary key (driver_id, captured_at) is the idempotency
-- key: a phone that retries a batch, or two requests carrying the same ping, cannot create a duplicate -- the database
-- decides, not a check-then-insert in application code.
--
-- `vehicle_positions` is the answer to "where is everyone now": one row per driver, upserted with "the newer capture wins",
-- so a batch that arrives late can never move a pin backwards, and the live map never scans history.

CREATE TABLE pings (
  driver_id   uuid                  NOT NULL,
  captured_at timestamptz           NOT NULL,
  fleet_id    uuid                  NOT NULL,
  vehicle_id  uuid                  NOT NULL,
  trip_id     uuid,
  geom        geography(Point,4326) NOT NULL,
  accuracy_m  real                  CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  speed_kmh   real                  CHECK (speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 400),
  heading_deg real                  CHECK (heading_deg IS NULL OR heading_deg >= 0 AND heading_deg < 360),
  source      text                  NOT NULL CHECK (source IN ('checkin', 'polling', 'batch')),
  received_at timestamptz           NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, captured_at)
) PARTITION BY RANGE (captured_at);

-- The trail of one trip, in order. Created on the parent, so every partition gets its own copy.
CREATE INDEX pings_trip_time ON pings (trip_id, captured_at) WHERE trip_id IS NOT NULL;

CREATE TABLE vehicle_positions (
  driver_id    uuid PRIMARY KEY,
  fleet_id     uuid                  NOT NULL,
  vehicle_id   uuid                  NOT NULL,
  trip_id      uuid,
  geom         geography(Point,4326) NOT NULL,
  accuracy_m   real,
  speed_kmh    real,
  heading_deg  real,
  captured_at  timestamptz           NOT NULL,
  -- The last capture that showed real movement: "stopped for 30 minutes" is a subtraction, not a scan of history.
  last_moved_at timestamptz,
  updated_at   timestamptz           NOT NULL DEFAULT now(),
  FOREIGN KEY (driver_id, fleet_id) REFERENCES users (id, fleet_id) ON DELETE CASCADE
);
CREATE INDEX vehicle_positions_fleet ON vehicle_positions (fleet_id);
CREATE INDEX vehicle_positions_geom  ON vehicle_positions USING gist (geom);
