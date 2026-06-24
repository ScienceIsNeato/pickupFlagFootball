-- Invariant: a registered user always has a home (zip + geocoded point), and that
-- home IS their interest signal. Enforce structurally — no homeless user rows.
--
-- Existing danglers (e.g. Google sign-ups or in-modal signups that never collected
-- a location) are removed first so the constraint can apply; they re-register
-- through the fixed, atomic flow. We clear their rows from every user-referencing
-- table explicitly rather than rely on ON DELETE CASCADE (a few FKs lack it).
-- Users are deleted last, so the homeless subquery stays valid for every step.
DELETE FROM interest_signals  WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM suggestions       WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM soft_promises     WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM game_roster       WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM game_attendance   WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM notifications_sent WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM area_captains      WHERE user_id IN (SELECT id FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL);
DELETE FROM users             WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL;

ALTER TABLE users ALTER COLUMN zip      SET NOT NULL;
ALTER TABLE users ALTER COLUMN home_lat SET NOT NULL;
ALTER TABLE users ALTER COLUMN home_lng SET NOT NULL;
