import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** A successful subscription checkout → the user is a subscriber (mutes the email
 *  reminder). Stores the Stripe ids so a later cancellation maps back. Returns
 *  false if no user matched the client_reference_id (the webhook 500s so Stripe
 *  retries rather than silently leaving a paying customer non-subscribed). */
export async function setSubscribed(
  userId: string, customerId: string | null, subscriptionId: string | null,
): Promise<boolean> {
  const updated = await db.update(users).set({
    donationStatus: "subscribed",
    ...(customerId ? { stripeCustomerId: customerId } : {}),
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, userId)).returning({ id: users.id });
  return updated.length > 0;
}

/** A cancelled / ended subscription. Matched on the specific subscription that
 *  was deleted (not just the customer), so a second subscription can't affect
 *  this one. The id is ALWAYS cleared (so it can't go stale and wrongly mark
 *  someone a subscriber), but the status flips to "unset" only if they were
 *  still "subscribed" — an explicit "declined" is preserved. */
export async function clearSubscription(subscriptionId: string): Promise<void> {
  await db.update(users).set({
    stripeSubscriptionId: null,
    donationStatus: sql`case when ${users.donationStatus} = 'subscribed' then 'unset'::donation_status else ${users.donationStatus} end`,
    updatedAt: new Date(),
  }).where(eq(users.stripeSubscriptionId, subscriptionId));
}
