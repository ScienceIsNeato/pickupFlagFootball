-- Per-site "minimum expected players" the captain configures.
--
-- The weekly occurrence poll already has a threshold (areas.min_players_to_schedule,
-- resolved by minPlayers() in lib/mime/occurrences.ts) deciding whether a given
-- week's game actually runs. It was per-AREA and hardcoded to 6. This adds a
-- per-GAME override so each site's captain can set the bar for their own game,
-- baking in local knowledge (some sites get more walk-ons than no-shows, others
-- the reverse). NULL means "fall back to the area/activity default" — every
-- existing game keeps behaving exactly as before.
--
-- Idempotent (IF NOT EXISTS + drop-then-add) so the pglite test harness, which
-- replays every migration over the baseline snapshot on a fresh DB, is safe.
-- The 2..60 bound matches the API/UI (setMinPlayers) so an out-of-band write
-- can't make a game impossible to hold or trivially always-on.
ALTER TABLE games ADD COLUMN IF NOT EXISTS min_players integer;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_min_players_positive;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_min_players_range;
ALTER TABLE games ADD CONSTRAINT games_min_players_range
  CHECK (min_players IS NULL OR min_players BETWEEN 2 AND 60);
