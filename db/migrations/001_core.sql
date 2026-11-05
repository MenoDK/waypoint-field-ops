-- Core entities. Every row that belongs to a fleet carries fleet_id, and every reference between two fleet-scoped rows is a
-- COMPOSITE foreign key (id, fleet_id): the database itself refuses a trip that links a vehicle of one fleet to a driver of
-- another, whatever the application code does.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE fleets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id uuid NOT NULL REFERENCES fleets (id),
  label    text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  UNIQUE (fleet_id, label),
  UNIQUE (id, fleet_id)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id      uuid        NOT NULL REFERENCES fleets (id),
  email         text        NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role          text        NOT NULL CHECK (role IN ('dispatcher', 'driver')),
  -- The vehicle a driver is assigned to. Their phone's pings are attributed to it.
  vehicle_id    uuid,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email),
  UNIQUE (id, fleet_id),
  FOREIGN KEY (vehicle_id, fleet_id) REFERENCES vehicles (id, fleet_id),
  CHECK (vehicle_id IS NULL OR role = 'driver')
);

-- A place is a point and a radius. The radius is the geofence: a vehicle inside it, confirmed twice, has arrived.
CREATE TABLE places (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id uuid                  NOT NULL REFERENCES fleets (id),
  name     text                  NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  geom     geography(Point,4326) NOT NULL,
  radius_m integer               NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 25 AND 2000),
  UNIQUE (fleet_id, name),
  UNIQUE (id, fleet_id)
);
CREATE INDEX places_geom ON places USING gist (geom);

CREATE TABLE trips (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id          uuid        NOT NULL,
  vehicle_id        uuid        NOT NULL,
  driver_id         uuid        NOT NULL,
  origin_id         uuid        NOT NULL,
  destination_id    uuid        NOT NULL,
  status            text        NOT NULL DEFAULT 'PLANNED'
                    CHECK (status IN ('PLANNED', 'ACCEPTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
  planned_departure timestamptz NOT NULL,
  expected_arrival  timestamptz NOT NULL,
  accepted_at       timestamptz,
  started_at        timestamptz,
  arrived_at        timestamptz,
  completed_at      timestamptz,
  km_start          integer CHECK (km_start >= 0),
  km_end            integer,
  notes             text    NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (vehicle_id, fleet_id)     REFERENCES vehicles (id, fleet_id),
  FOREIGN KEY (driver_id, fleet_id)      REFERENCES users (id, fleet_id),
  FOREIGN KEY (origin_id, fleet_id)      REFERENCES places (id, fleet_id),
  FOREIGN KEY (destination_id, fleet_id) REFERENCES places (id, fleet_id),
  UNIQUE (id, fleet_id),
  CHECK (expected_arrival > planned_departure),
  CHECK (origin_id <> destination_id),
  -- The odometer only runs forward, and a trip cannot be in a state without the facts that state implies.
  CHECK (km_end IS NULL OR (km_start IS NOT NULL AND km_end > km_start)),
  CHECK (status <> 'IN_TRANSIT' OR (km_start IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR (km_end IS NOT NULL AND completed_at IS NOT NULL))
);
-- One accepted-or-moving trip per driver and one moving trip per vehicle: enforced by the database, so two dispatchers
-- (or two parallel requests) cannot both win.
CREATE UNIQUE INDEX trips_one_active_per_driver  ON trips (driver_id)  WHERE status IN ('ACCEPTED', 'IN_TRANSIT');
CREATE UNIQUE INDEX trips_one_moving_per_vehicle ON trips (vehicle_id) WHERE status = 'IN_TRANSIT';
CREATE INDEX trips_fleet_status ON trips (fleet_id, status, planned_departure DESC);
CREATE INDEX trips_driver_time  ON trips (driver_id, started_at, completed_at);

-- Fixed-window counters for the sign-in endpoint (kept in the database so the limit holds across replicas).
CREATE TABLE rate_limits (
  key        text PRIMARY KEY,
  count      integer     NOT NULL,
  expires_at timestamptz NOT NULL
);
