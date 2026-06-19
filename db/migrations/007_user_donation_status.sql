-- Migration 007: per-user donation preference.
--
-- Self-declared, honor-system (no Stripe webhook). Drives the conditional
-- donation footer in the (Phase 6) weekly email: only 'unset' users get the
-- $5/month reminder; 'subscribed' and 'declined' both suppress it. Users set
-- this from their account page — "make a donation" or "I'd rather not".

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'donation_status') THEN
    CREATE TYPE donation_status AS ENUM ('unset', 'subscribed', 'declined');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS donation_status donation_status NOT NULL DEFAULT 'unset';
