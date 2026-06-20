-- Migration 010: per-game color stored on the row at creation time.
--
-- The map previously derived each game's badge ring + claimed-flag color by
-- hashing the game id at render time. That was deterministic but
-- non-inspectable (no DB column) and gave each weekly game instance its own
-- color even though they semantically represent the same recurring slot.
--
-- We now store the color on the row at insert time, derived per-area so every
-- weekly instance of a recurring game keeps the same color (Coralville is
-- always one color, Cedar Rapids another). Nullable for backward compatibility;
-- consumers fall back to the deterministic helper for any pre-migration rows.

ALTER TABLE games ADD COLUMN IF NOT EXISTS color text;
