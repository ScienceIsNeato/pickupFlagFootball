-- Per-occurrence RSVP for a game. game_roster is the standing membership; this
-- is the weekly layer: a roster member marks "in"/"out" for a specific date.
create table if not exists game_attendance (
  game_id         uuid not null references games(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  occurrence_date date not null,
  status          text not null check (status in ('in', 'out')),
  created_at      timestamptz not null default now(),
  primary key (game_id, user_id, occurrence_date)
);

create index if not exists idx_game_attendance_occurrence
  on game_attendance (game_id, occurrence_date) where status = 'in';
