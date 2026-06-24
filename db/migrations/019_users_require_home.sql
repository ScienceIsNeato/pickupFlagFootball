-- Invariant: a registered user always has a home (zip + geocoded point), and that
-- home IS their interest signal. Enforce structurally — no homeless user rows.
--
-- Existing danglers (e.g. Google sign-ups or in-modal signups that never collected
-- a location) are removed first so the constraint can apply; they re-register
-- through the fixed, atomic flow. Cascades clean their interest/roster rows.
DELETE FROM users WHERE zip IS NULL OR home_lat IS NULL OR home_lng IS NULL;

ALTER TABLE users ALTER COLUMN zip      SET NOT NULL;
ALTER TABLE users ALTER COLUMN home_lat SET NOT NULL;
ALTER TABLE users ALTER COLUMN home_lng SET NOT NULL;
