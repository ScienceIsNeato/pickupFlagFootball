-- Pickup Flag Football — canonical database schema (Postgres / Neon)
--
-- ACTIVITY-AGNOSTIC BY DESIGN. Nothing in the engine tables is flag-football-specific.
-- Flag football is one row in activity_types. Every matching-scoped table is
-- partitioned by activity_type_id. The engine speaks Participant / Interest /
-- Activity / Area / Event — never "field", "5v5", "flag".
--
-- NO PII. We store city + ZIP + a coarse H3 cell (home location snapped to a cell
-- center). We NEVER store a street address.
--
-- This is the canonical, ORM-agnostic source of truth. An ORM schema (e.g. Drizzle)
-- can be generated from it when the app is wired up.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================================ enums
CREATE TYPE time_slot AS ENUM (
  'weekday_am','weekday_midday','weekday_eve',
  'weekend_am','weekend_midday','weekend_pm'
);

CREATE TYPE area_status AS ENUM (
  'DORMANT','PRIMED','IN_FORMATION','SCHEDULED','STALLED'
);

CREATE TYPE attempt_status AS ENUM (
  'SUGGESTING','COMPILING','AVAILABILITY','ADJUDICATING',
  'CONFIRMED','FAILED','CANCELLED'
);

CREATE TYPE game_status AS ENUM ('STAGED','STANDING','CANCELLED','COMPLETED');

CREATE TYPE notification_kind AS ENUM (
  'SPARK_ASK','SUGGEST_NUDGE','SUGGEST_LASTCALL',
  'OPTIONS_AVAILABLE','AVAIL_NUDGE','AVAIL_LASTCALL',
  'GAME_ON','STALLED_NOTICE'
);

CREATE TYPE notification_channel AS ENUM ('push','email');

-- Self-declared donation preference. Drives the conditional email donation
-- footer: only 'unset' users get the $5/month reminder.
CREATE TYPE donation_status AS ENUM ('unset','subscribed','declined');

-- ============================================================ activity_types
-- The "skin" config. The engine depends only on these values, never on a hardcoded
-- sport. Seed row: flag football. A future tennis/basketball launch is a new row.
CREATE TABLE activity_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text UNIQUE NOT NULL,             -- 'flag-football'
  display_name     text NOT NULL,                    -- 'Flag football'
  noun_event       text NOT NULL DEFAULT 'game',     -- copy: 'game' | 'match' | 'session'
  noun_participant text NOT NULL DEFAULT 'player',
  -- default formation tunables (areas may override individual values)
  n_spark              int  NOT NULL DEFAULT 8,      -- interested to open first window
  n_warm               int  NOT NULL DEFAULT 5,      -- "almost there" UI
  p_min                int  NOT NULL DEFAULT 6,      -- soft-promises to confirm a game
  s_min                int  NOT NULL DEFAULT 1,      -- min suggestions to advance the window
  options_cap          int  NOT NULL DEFAULT 6,      -- max options in availability msg
  suggest_window       interval NOT NULL DEFAULT '48 hours',
  avail_window         interval NOT NULL DEFAULT '48 hours',
  restall_interest     int  NOT NULL DEFAULT 3,      -- new interest to re-trigger a stall
  restall_days         int  NOT NULL DEFAULT 14,     -- base cooldown before re-trigger
  max_time_retries     int  NOT NULL DEFAULT 2,      -- time-only retries before dormant
  max_catchment_km     double precision NOT NULL DEFAULT 12,
  base_h3_res          int  NOT NULL DEFAULT 7,      -- v1 matching resolution
  per_user_weekly_cap  int  NOT NULL DEFAULT 2,      -- anti-spam: msgs/user/week
  ignore_decay_windows int  NOT NULL DEFAULT 3,      -- auto-snooze after N ignored
  gear_catalog         jsonb NOT NULL DEFAULT '[]',  -- affiliate links
  seo_copy             jsonb NOT NULL DEFAULT '{}',  -- page title/description templates
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (n_spark > 0 AND n_warm >= 0 AND p_min > 0 AND s_min > 0 AND options_cap > 0
         AND restall_interest >= 0 AND restall_days >= 0 AND max_time_retries >= 0
         AND max_catchment_km > 0 AND base_h3_res BETWEEN 0 AND 15
         AND per_user_weekly_cap >= 0 AND ignore_decay_windows >= 0)
);

-- ============================================================ users
-- Profile + location + notification transport. Auth.js owns the auth tables
-- (accounts, sessions, verification_token) and references users.id via its adapter.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text,
  -- structured home address (optional beyond ZIP; server-only, used to geocode)
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  zip           text,
  -- home point: the geocoded address when given, else the ZIP centroid.
  -- Server-only — the map exposes only H3-cell centroids.
  home_lat      double precision,
  home_lng      double precision,
  -- how far the user will travel for a game (km); gates the map's cursor pull
  max_travel_km double precision NOT NULL DEFAULT 24.14,  -- ~15 mi
  -- derived H3 cell ids at multiple resolutions (computed in-app via h3-js)
  h3_r5         bigint,
  h3_r6         bigint,
  h3_r7         bigint,    -- base matching resolution (v1)
  h3_r8         bigint,
  h3_r9         bigint,
  timezone      text,      -- for quiet-hours
  push_subscription jsonb, -- Web Push subscription
  email_opt_in  boolean NOT NULL DEFAULT true,
  -- self-declared; drives the email donation footer (only 'unset' is reminded)
  donation_status donation_status NOT NULL DEFAULT 'unset',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (home_lat IS NULL OR home_lat BETWEEN -90 AND 90),
  CHECK (home_lng IS NULL OR home_lng BETWEEN -180 AND 180),
  CHECK (max_travel_km > 0)
);
CREATE INDEX idx_users_zip    ON users(zip);
CREATE INDEX idx_users_h3_r7  ON users(h3_r7);
CREATE INDEX idx_users_h3_r8  ON users(h3_r8);

-- ============================================================ areas
-- The stable matching + FSM + SEO unit: one per (activity_type, base H3 cell).
-- Created lazily when a cell first accrues interest. Catchment for counting is the
-- cell + its neighbor ring (computed in-app); this row anchors FSM/cooldown state.
CREATE TABLE areas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type_id uuid NOT NULL REFERENCES activity_types(id),
  h3_cell          bigint NOT NULL,            -- at activity's base_h3_res
  display_city     text,
  display_zip      text,
  center_lat       double precision NOT NULL,
  center_lng       double precision NOT NULL,
  -- FSM / cooldown state
  status                area_status NOT NULL DEFAULT 'DORMANT',
  stall_count           int NOT NULL DEFAULT 0,
  last_round_at         timestamptz,
  next_trigger_at       timestamptz,           -- cooldown re-prime by time
  next_trigger_interest int,                   -- cooldown re-prime by new interest
  -- optional per-area overrides (NULL → fall back to activity_types defaults)
  n_spark_override int,
  p_min_override   int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_type_id, h3_cell),
  -- composite-FK target so child rows can't mismatch area <-> activity
  UNIQUE (id, activity_type_id),
  CHECK (center_lat BETWEEN -90 AND 90 AND center_lng BETWEEN -180 AND 180)
);
CREATE INDEX idx_areas_status ON areas(activity_type_id, status);

-- ============================================================ interest_signals
CREATE TABLE interest_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type_id uuid NOT NULL REFERENCES activity_types(id),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id          uuid NOT NULL,
  h3_base          bigint NOT NULL,            -- denormalized for ring counting
  time_prefs       time_slot[] NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  -- per-(user,area) engagement state for anti-spam
  consecutive_ignored int NOT NULL DEFAULT 0,
  snoozed_until       timestamptz,
  last_responded_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- multiple interests allowed: a user can care about several areas (home, work, ...)
  -- for the same activity. One row per (user, activity, area).
  UNIQUE (activity_type_id, user_id, area_id),
  -- the area must belong to the same activity as the signal
  FOREIGN KEY (area_id, activity_type_id) REFERENCES areas(id, activity_type_id)
);
CREATE INDEX idx_interest_ring ON interest_signals(activity_type_id, h3_base) WHERE active;
CREATE INDEX idx_interest_area ON interest_signals(area_id) WHERE active;

-- ============================================================ formation_attempts
-- One critical-mass spark → one attempt covering the whole window lifecycle.
CREATE TABLE formation_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type_id uuid NOT NULL REFERENCES activity_types(id),
  area_id          uuid NOT NULL,
  attempt_number   int NOT NULL,
  status           attempt_status NOT NULL DEFAULT 'SUGGESTING',
  catchment_cells  bigint[] NOT NULL DEFAULT '{}',  -- claimed cells → overlap dedup
  cohort_user_ids  uuid[]  NOT NULL DEFAULT '{}',   -- frozen cohort snapshot at open
  suggestion_opened_at   timestamptz,
  suggestion_closes_at   timestamptz,
  availability_opened_at timestamptz,
  availability_closes_at timestamptz,
  scheduled_game_id uuid,                           -- set on CONFIRMED
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, attempt_number),
  -- composite-FK target so a game's area can't disagree with its attempt's area
  UNIQUE (id, area_id),
  FOREIGN KEY (area_id, activity_type_id) REFERENCES areas(id, activity_type_id),
  -- a confirmed attempt must point at the game it produced
  CHECK (status <> 'CONFIRMED' OR scheduled_game_id IS NOT NULL)
);
-- at most one live attempt per area
CREATE UNIQUE INDEX uq_one_live_attempt ON formation_attempts(area_id)
  WHERE status IN ('SUGGESTING','COMPILING','AVAILABILITY','ADJUDICATING');
-- scheduled-lambda lookups: which windows are due to close
CREATE INDEX idx_attempt_suggest_close ON formation_attempts(suggestion_closes_at)
  WHERE status = 'SUGGESTING';
CREATE INDEX idx_attempt_avail_close ON formation_attempts(availability_closes_at)
  WHERE status = 'AVAILABILITY';
-- overlap dedup: does a new catchment intersect an active one?
CREATE INDEX idx_attempt_catchment ON formation_attempts USING gin (catchment_cells);

-- ============================================================ suggestions
-- Raw human "here's a place & time" entries during the SUGGESTING window.
CREATE TABLE suggestions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES formation_attempts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  place_text    text NOT NULL,             -- public venue, free text
  place_lat     double precision,          -- optional venue coords (public place, not PII)
  place_lng     double precision,
  proposed_start timestamptz NOT NULL,
  option_id     uuid,                      -- assigned during COMPILING (dedupe grouping)
  created_at    timestamptz NOT NULL DEFAULT now()   -- TIE-BREAK: earliest wins
);
CREATE INDEX idx_suggestions_attempt ON suggestions(attempt_id, created_at);

-- ============================================================ formation_options
-- Deduped, capped (options_cap) list presented in the AVAILABILITY window.
CREATE TABLE formation_options (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES formation_attempts(id) ON DELETE CASCADE,
  place_text    text NOT NULL,
  place_lat     double precision,
  place_lng     double precision,
  proposed_start timestamptz NOT NULL,
  first_suggested_at timestamptz NOT NULL,  -- earliest source suggestion → TIE-BREAK key
  promise_count int NOT NULL DEFAULT 0,     -- denormalized tally
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- composite-FK target so promises/suggestions can't cross attempts
  UNIQUE (id, attempt_id)
);
CREATE INDEX idx_options_attempt ON formation_options(attempt_id);

-- suggestions.option_id is assigned during COMPILING; tie it to the same attempt
ALTER TABLE suggestions
  ADD CONSTRAINT fk_suggestion_option
  FOREIGN KEY (option_id, attempt_id) REFERENCES formation_options(id, attempt_id);

-- ============================================================ soft_promises
-- "If it's on, I'll be there" — recorded per option; a user may promise several.
CREATE TABLE soft_promises (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid NOT NULL REFERENCES formation_attempts(id) ON DELETE CASCADE,
  option_id   uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (option_id, user_id),
  -- the option must belong to this same attempt
  FOREIGN KEY (option_id, attempt_id) REFERENCES formation_options(id, attempt_id) ON DELETE CASCADE
);
CREATE INDEX idx_promises_option ON soft_promises(option_id);

-- ============================================================ games
-- A scheduled event. v2 promotes the first game to a recurring standing slot.
CREATE TABLE games (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type_id uuid NOT NULL REFERENCES activity_types(id),
  area_id          uuid NOT NULL,
  origin_attempt_id uuid REFERENCES formation_attempts(id),
  winning_option_id uuid REFERENCES formation_options(id),
  place_text       text NOT NULL,
  place_lat        double precision,
  place_lng        double precision,
  scheduled_start  timestamptz NOT NULL,
  status           game_status NOT NULL DEFAULT 'STAGED',
  confirmed_count  int NOT NULL DEFAULT 0,
  -- v2 recurring standing-slot fields
  is_standing      boolean NOT NULL DEFAULT false,
  recur_dow        int,        -- 0-6
  recur_time       time,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (area_id, activity_type_id) REFERENCES areas(id, activity_type_id),
  -- the winning option must come from this game's originating attempt
  FOREIGN KEY (winning_option_id, origin_attempt_id) REFERENCES formation_options(id, attempt_id),
  -- the originating attempt must belong to this same area
  FOREIGN KEY (origin_attempt_id, area_id) REFERENCES formation_attempts(id, area_id),
  -- a winning option only makes sense alongside its origin attempt
  CHECK (winning_option_id IS NULL OR origin_attempt_id IS NOT NULL),
  CHECK (recur_dow IS NULL OR recur_dow BETWEEN 0 AND 6)
);
CREATE INDEX idx_games_area ON games(activity_type_id, area_id);

-- close the attempt → game cycle now that games exists
ALTER TABLE formation_attempts
  ADD CONSTRAINT fk_attempt_game
  FOREIGN KEY (scheduled_game_id) REFERENCES games(id);

-- ============================================================ game_roster
CREATE TABLE game_roster (
  game_id    uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  source     text NOT NULL DEFAULT 'soft_promise',  -- v2: 'weekly_rsvp'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

-- ============================================================ notifications_sent
-- Idempotency (claim-before-send) + anti-spam ledger.
CREATE TABLE notifications_sent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id  uuid NOT NULL REFERENCES formation_attempts(id) ON DELETE CASCADE,
  game_id     uuid REFERENCES games(id) ON DELETE CASCADE,
  kind        notification_kind NOT NULL,
  channel     notification_channel NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, attempt_id, kind, channel)        -- exactly-once per round message
);
CREATE INDEX idx_notif_user_week ON notifications_sent(user_id, sent_at);  -- per-user cap

-- ============================================================ map_aggregates
-- Materialized interest counts per (activity, resolution, cell) for the zoom map.
-- Refreshed on interest change or by the scheduled lambda.
CREATE TABLE map_aggregates (
  activity_type_id uuid NOT NULL REFERENCES activity_types(id),
  resolution     int NOT NULL,        -- H3 resolution (map zoom level)
  h3_cell        bigint NOT NULL,
  interest_count int NOT NULL DEFAULT 0,
  has_game       boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_type_id, resolution, h3_cell)
);

-- ============================================================ seed
INSERT INTO activity_types (slug, display_name, noun_event, noun_participant)
VALUES ('flag-football', 'Flag football', 'game', 'player');
