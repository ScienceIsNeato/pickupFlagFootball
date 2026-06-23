-- A pause is a seasonal break, not an open-ended stop: it carries an expected
-- resumption date and a captain's note (both required at pause time, enforced in
-- the action). Cleared when the series resumes or retires.
ALTER TABLE games ADD COLUMN IF NOT EXISTS paused_until date;
ALTER TABLE games ADD COLUMN IF NOT EXISTS pause_note  text;
