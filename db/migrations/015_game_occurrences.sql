-- Migration 015: game state-machine foundation (additive).
-- See docs/state-machines.md. Adds the per-site poll config and the per-week
-- occurrence lifecycle. Nothing here changes existing behavior — the cron poll
-- cycle (phase 2) and the game_status split (phase 3) build on top of it.

-- Per-site config that drives the weekly RSVP poll.
ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS min_players_to_schedule int      NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS polling_window_length   interval NOT NULL DEFAULT '24 hours',
  ADD COLUMN IF NOT EXISTS polling_start_offset    interval NOT NULL DEFAULT '48 hours';

-- The per-week occurrence lifecycle.
DO $$ BEGIN
  CREATE TYPE occurrence_status AS ENUM (
    'pending','polling','tallying','scheduled','skipped','notifying','awaiting_game','played','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS game_occurrences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status          occurrence_status NOT NULL DEFAULT 'pending',
  kickoff_at      timestamptz NOT NULL,            -- when this week's game starts
  poll_opens_at   timestamptz NOT NULL,            -- kickoff_at - polling_start_offset
  poll_closes_at  timestamptz NOT NULL,            -- poll_opens_at + polling_window_length
  in_count        int NOT NULL DEFAULT 0,          -- RSVP'd "in" recorded at tally
  notified_at     timestamptz,                     -- when the status email went out
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, occurrence_date)
);

-- The cron finds work by (status, time): poll-opens due, poll-closes due.
CREATE INDEX IF NOT EXISTS idx_occurrences_poll_open  ON game_occurrences(status, poll_opens_at);
CREATE INDEX IF NOT EXISTS idx_occurrences_poll_close ON game_occurrences(status, poll_closes_at);
CREATE INDEX IF NOT EXISTS idx_occurrences_kickoff    ON game_occurrences(status, kickoff_at);
