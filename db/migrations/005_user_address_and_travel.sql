-- Migration 005: per-user max travel distance + precise home address.
--
-- home_lat/home_lng may now hold the user's actual picked address (precise),
-- not just a ZIP-centroid snap. It stays server-only — the map sends only
-- H3-cell centroids, never a user's point — and is used to measure how far a
-- game is from the user. max_travel_km is that distance threshold (default 40km
-- ~= 25mi) and gates which clusters the map's cursor will pull.

ALTER TABLE users ADD COLUMN IF NOT EXISTS max_travel_km double precision NOT NULL DEFAULT 40;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_users_max_travel_km'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_max_travel_km CHECK (max_travel_km > 0);
  END IF;
END $$;
