-- Per-site default RSVP for a roster member: "usually come" (in) / "usually
-- won't" (out). Upcoming occurrences inherit this unless explicitly overridden
-- in game_attendance.
alter table game_roster
  add column if not exists default_status text not null default 'in'
  check (default_status in ('in', 'out'));
