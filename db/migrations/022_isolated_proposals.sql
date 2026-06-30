-- Isolated-proposal formation model. Collapse the area-wide multi-phase FSM
-- (suggest → compile → vote → adjudicate) into one isolated attempt per proposal:
-- formation_attempts IS the proposal (place/day/time + a single interest window),
-- people respond Interested/Not-Interested in attempt_interest, and the engine
-- forms the game (enough interested) or fails the attempt at the deadline.
--
-- Greenfield: no live formation data worth preserving (suggestions / options /
-- soft-promises had no real UI). The old enum values (SUGGESTING…, SPARK_ASK…)
-- are left in place but unused — recreating the enum trips dependency checks, and
-- dead values are harmless; drizzle's schema.ts carries the trimmed set.

-- New enum values must be committed before they're used (and can't be added then
-- used in the same transaction), so they go first, outside the main txn.
ALTER TYPE attempt_status ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'GAME_PROPOSED';

BEGIN;

-- Clear stale formation data; drop in dependency order (games + suggestions
-- reference formation_options).
DELETE FROM formation_attempts;
ALTER TABLE games DROP COLUMN IF EXISTS winning_option_id;
DROP TABLE IF EXISTS soft_promises;
DROP TABLE IF EXISTS suggestions;
DROP TABLE IF EXISTS formation_options;

-- formation_attempts carries the proposal directly + a single interest window.
ALTER TABLE formation_attempts
  DROP COLUMN IF EXISTS suggestion_opened_at,
  DROP COLUMN IF EXISTS suggestion_closes_at,
  DROP COLUMN IF EXISTS availability_opened_at,
  DROP COLUMN IF EXISTS availability_closes_at,
  ADD COLUMN proposer_id uuid NOT NULL REFERENCES users(id),
  ADD COLUMN place_text text NOT NULL,
  ADD COLUMN place_lat double precision,
  ADD COLUMN place_lng double precision,
  ADD COLUMN proposed_start timestamptz NOT NULL,
  ADD COLUMN recur_dow integer,
  ADD COLUMN recur_time time,
  ADD COLUMN interest_closes_at timestamptz NOT NULL;
-- Drop the stale 'SUGGESTING' default; inserts always set status explicitly. (We
-- can't SET DEFAULT 'OPEN' here — the value was added this migration and pglite
-- runs the file as one transaction. drizzle's schema carries the 'OPEN' default.)
ALTER TABLE formation_attempts ALTER COLUMN status DROP DEFAULT;

DROP INDEX IF EXISTS uq_one_live_attempt;
DROP INDEX IF EXISTS idx_attempt_suggest_close;
DROP INDEX IF EXISTS idx_attempt_avail_close;
CREATE INDEX idx_attempt_open_close ON formation_attempts (status, interest_closes_at);

-- Interest responses (replaces soft_promises): one row per user per proposal.
CREATE TABLE attempt_interest (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES formation_attempts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  interested boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_attempt_interest ON attempt_interest (attempt_id, user_id);

COMMIT;
