"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, activityTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureArea, milesToKm, resolveHome } from "@/lib/geo";
import { evaluate } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";
import { txnDb } from "@/lib/db/pool";
import { setActiveInterest } from "@/lib/db/interest";
import { str } from "@/lib/forms";

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function updateAccount(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const displayName = str(formData.get("displayName")) || null;
  const city = str(formData.get("city"));
  const zip = str(formData.get("zip"));
  const line1 = str(formData.get("address_line1"));
  const line2 = str(formData.get("address_line2"));
  const state = str(formData.get("state"));

  const update: Record<string, unknown> = {
    displayName,
    updatedAt: new Date(),
  };

  // Travel radius — entered in miles, stored in km. Updatable on its own.
  // Bound it server-side (the form caps at 100; a raw POST could send anything).
  const miles = Number(str(formData.get("max_travel_miles")));
  if (Number.isFinite(miles) && miles >= 1 && miles <= 100) update.maxTravelKm = milesToKm(miles);

  if (zip && /^\d{5}$/.test(zip)) {
    const home = await resolveHome({ zip, line1, line2, city, state });
    if (!home) return { ok: false, error: "We couldn't find that ZIP code." };
    {
      const { displayCity, homeLat, homeLng, snapLat, snapLng, r5, r6, r7, r8, r9 } = home;

      Object.assign(update, {
        addressLine1: line1 || null,
        addressLine2: line2 || null,
        city: displayCity,
        state: state || null,
        zip,
        homeLat,
        homeLng,
        h3R5: r5,
        h3R6: r6,
        h3R7: r7,
        h3R8: r8,
        h3R9: r9,
      });

      // Ensure area + update existing interest signal's area reference
      const activity = await db
        .select({ id: activityTypes.id })
        .from(activityTypes)
        .where(eq(activityTypes.slug, "flag-football"))
        .limit(1);

      if (activity.length) {
        const activityTypeId = activity[0].id;
        const areaId = await ensureArea(activityTypeId, r7, {
          city: displayCity,
          zip,
          centerLat: snapLat,
          centerLng: snapLng,
        });
        // Save the profile (home/ZIP/center) first, then move interest. neon-http
        // has no transaction, so order matters: writing the home before pointing
        // interest at the new area means a failure can't leave interest at the new
        // spot while the profile still shows the old one. The interest move itself
        // is a single atomic statement, so it can't strand the user with zero
        // active interest either.
        await db.update(users).set(update).where(eq(users.id, session.user.id!));
        await setActiveInterest(activityTypeId, session.user.id!, areaId, r7);
        // the move may spark the new area (transactional — needs the pooled client)
        await evaluate(txnDb as unknown as EngineDb, activityTypeId, areaId, new Date());
        revalidatePath("/account");
        return { ok: true };
      } else {
        // A valid ZIP was given but the activity isn't configured. Don't write
        // the new home while leaving interest_signals pointed at the old area —
        // that desyncs the profile from the map. Fail the whole save instead.
        return { ok: false, error: "Flag football isn't configured yet." };
      }
    }
  } else if (city) {
    update.city = city;
  }

  await db
    .update(users)
    .set(update)
    .where(eq(users.id, session.user.id!));

  revalidatePath("/account");
  return { ok: true };
}

// Donation preference is self-declared and independent of location, so it has
// its own action — it must NOT re-run the ZIP/geocode path in updateAccount.
const DONATION_STATUSES = ["unset", "subscribed", "declined"] as const;
type DonationStatus = (typeof DONATION_STATUSES)[number];

export async function updateDonationPref(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const value = str(formData.get("donation_status"));
  if (!DONATION_STATUSES.includes(value as DonationStatus)) {
    throw new Error("invalid donation status");
  }

  await db
    .update(users)
    .set({ donationStatus: value as DonationStatus, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  redirect("/account");
}
