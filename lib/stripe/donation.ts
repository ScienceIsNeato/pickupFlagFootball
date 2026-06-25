import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** A successful subscription checkout → the user is a subscriber (mutes the email
 *  reminder). Stores the Stripe ids so a later cancellation maps back to them. */
export async function setSubscribed(
  userId: string, customerId: string | null, subscriptionId: string | null,
): Promise<void> {
  await db.update(users).set({
    donationStatus: "subscribed",
    ...(customerId ? { stripeCustomerId: customerId } : {}),
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

/** A cancelled / ended subscription → back to the gentle reminder ("unset"). We
 *  only flip a current subscriber, so an explicit "declined" is left alone. */
export async function clearSubscription(customerId: string): Promise<void> {
  await db.update(users).set({
    donationStatus: "unset",
    stripeSubscriptionId: null,
    updatedAt: new Date(),
  }).where(and(eq(users.stripeCustomerId, customerId), eq(users.donationStatus, "subscribed")));
}
