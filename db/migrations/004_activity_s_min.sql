-- Migration 004: s_min tunable on activity_types (min suggestions to advance
-- past the suggestion window). Mirrors the Tunables.sMin field; was previously
-- only a code default.

ALTER TABLE activity_types ADD COLUMN IF NOT EXISTS s_min int NOT NULL DEFAULT 1;
