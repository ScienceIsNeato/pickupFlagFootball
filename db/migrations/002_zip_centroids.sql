-- Migration 002: zip_centroids lookup table
-- Public-domain Census ZCTA centroid data; seeded once via scripts/seed-zip-centroids.mjs

CREATE TABLE IF NOT EXISTS zip_centroids (
  zip   text PRIMARY KEY,
  city  text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  lat   double precision NOT NULL,
  lng   double precision NOT NULL
);
