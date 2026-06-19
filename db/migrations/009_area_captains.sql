create table area_captains (
  area_id           uuid        not null references areas(id) on delete cascade,
  user_id           uuid        not null references users(id) on delete cascade,
  became_captain_at timestamptz not null default now(),
  primary key (area_id, user_id)
);
