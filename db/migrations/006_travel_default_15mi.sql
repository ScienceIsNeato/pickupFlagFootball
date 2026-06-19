-- Migration 006: change the default travel radius to ~15 miles (24.14 km).
-- Was 40 km (~25 mi). Only affects new rows that don't set max_travel_km
-- (e.g. onboarding, which doesn't ask for it); existing users keep their value.

ALTER TABLE users ALTER COLUMN max_travel_km SET DEFAULT 24.14;
