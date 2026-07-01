-- Bring migrated databases in line with the Drizzle schema after 022's reshape.
-- 022 is already applied (it can't be edited retroactively), so the two invariants
-- it couldn't express land here as their own migration:
--
-- (1) status default. 022 had to DROP the default because the 'OPEN' enum value was
--     added in that same migration (can't add + use a value in one txn). Now that
--     'OPEN' is committed, restore the default the ORM declares (.default("OPEN")),
--     so a migrated prod DB matches greenfield/test. Inserts set status explicitly,
--     so this is a belt-and-suspenders default.
--
-- (2) (area_id, attempt_number) uniqueness. proposeGame allocates attempt_number
--     under an area-row lock specifically so this pair stays unique; restore the
--     constraint as the backstop that makes a duplicate impossible even if that
--     lock path is ever bypassed.

ALTER TABLE formation_attempts ALTER COLUMN status SET DEFAULT 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS uq_attempt_area_number
  ON formation_attempts (area_id, attempt_number);
