"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/client";

const baseUrl = () => process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

/** Start the $5/mo donation: create a Stripe Checkout (subscription) session and
 *  send the user to it. Login-gated so the webhook can flip their status; reuses
 *  their Stripe customer on a re-subscribe. */
export async function startSubscription() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/donate");
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID not set");

  const [u] = await db.select({ email: users.email, customerId: users.stripeCustomerId })
    .from(users).where(eq(users.id, session.user.id)).limit(1);

  const cs = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: session.user.id, // the webhook maps this back to the user
    ...(u?.customerId ? { customer: u.customerId } : { customer_email: u?.email }),
    success_url: `${baseUrl()}/account?donated=1`,
    cancel_url: `${baseUrl()}/donate`,
  });
  if (!cs.url) throw new Error("stripe returned no checkout url");
  redirect(cs.url);
}

/** Open Stripe's hosted billing portal so a subscriber can update or cancel. */
export async function openBillingPortal() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/account");
  const [u] = await db.select({ customerId: users.stripeCustomerId })
    .from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u?.customerId) redirect("/donate"); // nothing to manage yet

  const ps = await stripe().billingPortal.sessions.create({
    customer: u.customerId,
    return_url: `${baseUrl()}/account`,
  });
  redirect(ps.url);
}
