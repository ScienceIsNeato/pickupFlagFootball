"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { txnDb } from "@/lib/db/pool";
import { users, activityTypes } from "@/lib/db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { ensureArea, milesToKm, resolveHome } from "@/lib/geo";
import { setActiveInterest } from "@/lib/db/interest";
import { str } from "@/lib/forms";

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * The one "Save Changes" action for the account page — saves the display name,
 * location (ZIP/address/travel radius), and the donation-reminder preference in a
 * single submit. Validate-then-write: the only thing that can fail is the geocode,
 * so we resolve the home BEFORE any write and bail with an error if it can't be
 * found — nothing is half-saved.
 */
export async function saveAccount(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const uid = session.user.id;

  // Current values — to skip a needless re-geocode on a name-only save, and to
  // know whether the reminder pref is ours to touch (subscribers are webhook-managed).
  const [cur] = await db.select({
    zip: users.zip, addressLine1: users.addressLine1, addressLine2: users.addressLine2,
    city: users.city, state: users.state,
    donationStatus: users.donationStatus, subId: users.stripeSubscriptionId,
  }).from(users).where(eq(users.id, uid)).limit(1);

  const zip = str(formData.get("zip"));
  const line1 = str(formData.get("address_line1"));
  const line2 = str(formData.get("address_line2"));
  const city = str(formData.get("city"));
  const state = str(formData.get("state"));

  const update: Record<string, unknown> = {
    displayName: str(formData.get("displayName")) || null,
    updatedAt: new Date(),
  };
  // Travel radius — entered in miles, stored in km. Bound it server-side (the form
  // caps at 100; a raw POST could send anything).
  const miles = Number(str(formData.get("max_travel_miles")));
  if (Number.isFinite(miles) && miles >= 1 && miles <= 100) update.maxTravelKm = milesToKm(miles);

  // Did the user edit any location field? Keep this separate from "is the ZIP
  // valid": a malformed ZIP edit must surface an error, not silently fall through
  // to a name-only save that reports success while quietly dropping the move.
  const locEdited = (
    zip !== (cur?.zip ?? "") || line1 !== (cur?.addressLine1 ?? "") ||
    line2 !== (cur?.addressLine2 ?? "") || city !== (cur?.city ?? "") || state !== (cur?.state ?? "")
  );
  if (locEdited && !/^\d{5}$/.test(zip)) return { ok: false, error: "Enter a valid 5-digit ZIP code." };

  if (locEdited) {
    const home = await resolveHome({ zip, line1, line2, city, state });
    if (!home) return { ok: false, error: "We couldn't find that ZIP code." };
    const [activity] = await db.select({ id: activityTypes.id }).from(activityTypes)
      .where(eq(activityTypes.slug, "flag-football")).limit(1);
    if (!activity) return { ok: false, error: "Flag football isn't configured yet." };

    Object.assign(update, {
      addressLine1: line1 || null, addressLine2: line2 || null,
      city: home.displayCity, state: state || null, zip,
      homeLat: home.homeLat, homeLng: home.homeLng,
      h3R5: home.r5, h3R6: home.r6, h3R7: home.r7, h3R8: home.r8, h3R9: home.r9,
    });
    const areaId = await ensureArea(activity.id, home.r7, {
      city: home.displayCity, zip, centerLat: home.snapLat, centerLng: home.snapLng,
    });
    // The profile move and the interest move are one unit — "home IS the interest
    // signal" (lib/db/schema.ts) — so commit them together on the pooled client. A
    // half-write (profile moved, interest stranded at the old area) breaks that
    // invariant; the transaction rolls both back on any failure.
    await txnDb.transaction(async (tx) => {
      await tx.update(users).set(update).where(eq(users.id, uid));
      await setActiveInterest(activity.id, uid, areaId, home.r7, tx);
    });
  } else {
    await db.update(users).set(update).where(eq(users.id, uid));
  }

  // Self-declared donation status (honor system) from the two checkboxes — skip for a
  // legacy Stripe subscriber (that status is webhook-managed). "I've donated" wins;
  // otherwise the reminder checkbox picks ask (unset) vs stop-asking (declined).
  if (!cur?.subId) {
    const supporter = formData.get("supporter") != null;
    const remind = formData.get("remind") != null;
    await db.update(users)
      .set({ donationStatus: supporter ? "subscribed" : remind ? "unset" : "declined", updatedAt: new Date() })
      .where(eq(users.id, uid));
  }

  // Refresh the account AND the app-wide donation banner (it keys off this pref).
  revalidatePath("/", "layout");
  return { ok: true };
}

// Shared write for the reminder preference: checked → remind ("unset"),
// unchecked / dismissed → "declined". Never clobbers an active subscription: guard
// on BOTH the status and the Stripe subscription id, so a subscriber whose
// donationStatus is momentarily stale (webhook-lagged) can't have "declined"
// written over their Stripe-managed state by a banner dismissal.
async function setReminder(userId: string, remind: boolean) {
  await db
    .update(users)
    .set({ donationStatus: remind ? "unset" : "declined", updatedAt: new Date() })
    .where(and(
      eq(users.id, userId),
      ne(users.donationStatus, "subscribed"),
      isNull(users.stripeSubscriptionId),
    ));
}

/** Banner "stop asking for contributions" — turns the reminder off and refreshes
 *  the layout so the banner disappears app-wide. Stays put (no navigation). */
export async function dismissDonationReminder() {
  const session = await auth();
  if (!session?.user?.id) return;
  await setReminder(session.user.id, false);
  revalidatePath("/", "layout");
}
