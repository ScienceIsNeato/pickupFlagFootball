-- Migration 003: email/password auth columns on users
-- password_hash is NULL for Google-only accounts; set for email/password accounts.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified timestamptz;
