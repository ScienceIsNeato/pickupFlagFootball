-- Migration 017: series status. The game row is the standing SERIES now, so its
-- status becomes active / paused / retired. game_status (STAGED / STANDING /
-- COMPLETED / CANCELLED) is retired — the per-week lifecycle lives on
-- game_occurrences (migration 015). Greenfield: no data to preserve, so any
-- leftover row maps to active (a cancelled one to retired).
CREATE TYPE series_status AS ENUM ('active', 'paused', 'retired');

ALTER TABLE games ALTER COLUMN status DROP DEFAULT;
ALTER TABLE games ALTER COLUMN status TYPE series_status USING (
  CASE status::text WHEN 'CANCELLED' THEN 'retired' ELSE 'active' END::series_status
);
ALTER TABLE games ALTER COLUMN status SET DEFAULT 'active';

DROP TYPE game_status;
