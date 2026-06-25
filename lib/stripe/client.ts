import Stripe from "stripe";

let client: Stripe | null = null;

/** Lazy Stripe client. Throws if STRIPE_SECRET_KEY is unset — only the donation
 *  routes call it, so the app still boots when Stripe isn't configured yet. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  if (!client) client = new Stripe(key);
  return client;
}

/** Whether the integrated subscription flow is wired (key + recurring price).
 *  The donate page falls back to a plain link until this is true. */
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}
