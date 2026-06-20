-- Outbox flush: notifications_sent is the claim ledger (one row per user/attempt/
-- kind/channel). emailed_at marks when the email was actually delivered via Brevo;
-- NULL = claimed but not yet sent. The cron flush picks these up.
alter table notifications_sent add column if not exists emailed_at timestamptz;

-- Existing claims predate the email layer — mark them already-handled so turning
-- on Brevo doesn't retroactively blast the whole historical backlog. Only claims
-- created after this point get emailed.
update notifications_sent set emailed_at = sent_at where emailed_at is null;

-- Fast lookup of the unsent email backlog.
create index if not exists idx_notif_unsent
  on notifications_sent (sent_at)
  where emailed_at is null and channel = 'email';
