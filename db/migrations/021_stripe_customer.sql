-- Stripe identifiers for the donation subscription. The webhook maps a Stripe
-- customer/subscription back to the user to keep donation_status in sync.
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_stripe_customer ON users(stripe_customer_id);
