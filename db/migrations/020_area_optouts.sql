-- Per-site "not interested": a user opts out of a forming site's courting.
-- They keep their interest signals (still free interest elsewhere); the
-- formation catchment for THIS area just stops counting and asking them.
CREATE TABLE IF NOT EXISTS area_optouts (
  area_id    uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_area_optouts_user ON area_optouts(user_id);
