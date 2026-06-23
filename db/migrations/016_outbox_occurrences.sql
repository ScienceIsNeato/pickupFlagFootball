-- Migration 016: generalize the notification outbox so the weekly poll emails
-- (which hang off an occurrence, not a formation attempt) reuse the same
-- claim-before-send ledger + Brevo flush. See docs/state-machines.md.

-- attempt_id is no longer required.
ALTER TABLE notifications_sent ALTER COLUMN attempt_id DROP NOT NULL;
ALTER TABLE notifications_sent
  ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES game_occurrences(id) ON DELETE CASCADE;

-- A notification is about exactly one parent: a formation attempt OR an occurrence.
ALTER TABLE notifications_sent DROP CONSTRAINT IF EXISTS notif_one_parent;
ALTER TABLE notifications_sent ADD CONSTRAINT notif_one_parent
  CHECK ((attempt_id IS NOT NULL) <> (occurrence_id IS NOT NULL));

-- Exactly-once per parent: replace the single (user, attempt, kind, channel)
-- index with two partial indexes, one per parent type.
DROP INDEX IF EXISTS uq_notif_once;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_attempt
  ON notifications_sent (user_id, attempt_id, kind, channel) WHERE attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_occurrence
  ON notifications_sent (user_id, occurrence_id, kind, channel) WHERE occurrence_id IS NOT NULL;

-- Weekly-poll notification kinds (ALTER TYPE ADD VALUE is not used in the same
-- transaction it's added in, so this is safe).
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'POLL_ASK';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'WEEK_ON';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'WEEK_OFF';
