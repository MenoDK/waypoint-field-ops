-- Partition maintenance is the one piece of DDL the application needs at run time. Rather than make the application role the
-- owner of the tables (which would let a SQL injection drop them), the owner defines two narrow SECURITY DEFINER functions
-- and the application role may only call those. `search_path` is pinned so a function cannot be hijacked by a look-alike object.

CREATE FUNCTION ensure_ping_partitions(days_behind integer, days_ahead integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  day     date;
  created integer := 0;
  name    text;
BEGIN
  IF days_behind NOT BETWEEN 0 AND 400 OR days_ahead NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'partition window out of range';
  END IF;
  FOR day IN SELECT d::date FROM generate_series(
      (now() AT TIME ZONE 'UTC')::date - days_behind, (now() AT TIME ZONE 'UTC')::date + days_ahead, interval '1 day') AS d
  LOOP
    name := 'pings_' || to_char(day, 'YYYYMMDD');
    IF to_regclass(format('public.%I', name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.pings FOR VALUES FROM (%L) TO (%L)',
        name, (day::timestamp AT TIME ZONE 'UTC'), ((day + 1)::timestamp AT TIME ZONE 'UTC'));
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Drops every daily partition that ends before `cutoff` (whole days only: a partition is never half-dropped).
CREATE FUNCTION drop_ping_partitions_before(cutoff timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  part    record;
  dropped integer := 0;
  day     date;
BEGIN
  FOR part IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'public.pings'::regclass AND c.relname ~ '^pings_[0-9]{8}$'
  LOOP
    day := to_date(substr(part.relname, 7), 'YYYYMMDD');
    IF ((day + 1)::timestamp AT TIME ZONE 'UTC') <= cutoff THEN
      EXECUTE format('DROP TABLE public.%I', part.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END $$;

REVOKE ALL ON FUNCTION ensure_ping_partitions(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION drop_ping_partitions_before(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_ping_partitions(integer, integer) TO app_user;
GRANT EXECUTE ON FUNCTION drop_ping_partitions_before(timestamptz) TO app_user;

-- Least privilege for the runtime role. History is append-only for the application: it can insert pings and read them, and
-- the only way a ping ever disappears is the retention function above.
GRANT SELECT, INSERT, UPDATE, DELETE ON fleets, users, vehicles, places, trips, vehicle_positions, alerts, units, tickets,
  rate_limits TO app_user;
GRANT SELECT, INSERT ON pings TO app_user;

-- The window the first start needs; the worker keeps it rolling.
SELECT ensure_ping_partitions(2, 3);
