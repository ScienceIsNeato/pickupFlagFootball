-- Email verification for password accounts. users.email_verified already exists
-- (Google sign-ins set it; password sign-ups leave it NULL until they confirm).
-- verification_token is the single-use secret emailed in the confirm link.
alter table users add column if not exists verification_token text;

create index if not exists idx_users_verification_token
  on users (verification_token) where verification_token is not null;
