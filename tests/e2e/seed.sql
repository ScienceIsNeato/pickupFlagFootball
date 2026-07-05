-- Deterministic seed for the e2e tests. Applied after db/schema.sql on a fresh
-- DB each run (see globalSetup). Keep this small and fixed — every row here is
-- something a user story depends on.

-- The activity registration needs (saveLocationAndInterest looks up this slug).
INSERT INTO activity_types (slug, display_name)
VALUES ('flag-football', 'Flag football')
ON CONFLICT (slug) DO NOTHING;

-- ZIP centroids the scenarios use. Prod pulls 30k+ from the Census; tests only
-- need the handful the stories reference, with fixed coordinates.
--   78701 — downtown Austin: the in-range "home" ZIP
--   78613 — Cedar Park, ~18mi NW of downtown: just outside the 15mi default radius
--   90001 — Los Angeles: far out of range, different metro
--   10001 — Manhattan: a third metro, isolated for the map-HUD ambient-interest story
--   60601 — Chicago: a fourth metro, isolated for the map-HUD open-proposal story
--   94102 — San Francisco: a fifth metro, isolated for the map-HUD live-refresh story
--   30301 — Atlanta: a sixth metro, isolated for the HUD walkthrough story
INSERT INTO zip_centroids (zip, city, state, lat, lng) VALUES
  ('78701', 'Austin',      'TX', 30.2711, -97.7437),
  ('78613', 'Cedar Park',  'TX', 30.5052, -97.8203),
  ('90001', 'Los Angeles', 'CA', 33.9731, -118.2479),
  ('10001', 'New York',    'NY', 40.7506, -73.9972),
  ('60601', 'Chicago',     'IL', 41.8853, -87.6217),
  ('94102', 'San Francisco', 'CA', 37.7793, -122.4193),
  ('30301', 'Atlanta',     'GA', 33.7628, -84.4220)
ON CONFLICT (zip) DO NOTHING;
