-- Migration 008: recurring weekly slot on suggestions.
--
-- A map proposal now carries the weekday + time the proposer wants the game to
-- recur on (local wall-clock), plus proposed_start as the first game. NULL means
-- a one-off. When a formation adjudicates, the winning suggestion's recurrence
-- promotes the created game to a standing weekly slot.

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS recur_dow int;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS recur_time time;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_suggestions_recur_dow' AND conrelid = 'suggestions'::regclass
  ) THEN
    ALTER TABLE suggestions
      ADD CONSTRAINT chk_suggestions_recur_dow CHECK (recur_dow IS NULL OR recur_dow BETWEEN 0 AND 6);
  END IF;
END $$;
