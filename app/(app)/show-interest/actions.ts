"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, activityTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ensureArea, resolveHome } from "@/lib/geo";
import { setActiveInterest } from "@/lib/db/interest";
import { str } from "@/lib/forms";

export type LocationResult = { ok: true } | { ok: false; error: string };

/** Core: write the user's home + (re)point their active interest at the home
 *  area. Returns a result; callers decide whether to redirect. No auto-spark —
 *  interest only feeds counts/cohort; formations start from a human proposal. */
async function applyLocationAndInterest(userId: string, formData: FormData): Promise<LocationResult> {
  const zip = str(formData.get("zip"));
  const city = str(formData.get("city"));
  const line1 = str(formData.get("address_line1"));
  const line2 = str(formData.get("address_line2"));
  const state = str(formData.get("state"));
  if (!/^\d{5}$/.test(zip)) return { ok: false, error: "Enter a valid 5-digit ZIP code." };

  const home = await resolveHome({ zip, line1, line2, city, state });
  if (!home) return { ok: false, error: "We couldn't find that ZIP code." };
  const { displayCity, homeLat, homeLng, snapLat, snapLng, r5, r6, r7, r8, r9 } = home;

  await db.update(users).set({
    addressLine1: line1 || null, addressLine2: line2 || null,
    city: displayCity, state: state || null, zip,
    homeLat, homeLng, h3R5: r5, h3R6: r6, h3R7: r7, h3R8: r8, h3R9: r9,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  const [activity] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!activity) return { ok: false, error: "Flag football isn't configured yet." };

  const areaId = await ensureArea(activity.id, r7, {
    city: displayCity, zip, centerLat: snapLat, centerLng: snapLng,
  });
  await setActiveInterest(activity.id, userId, areaId, r7);
  return { ok: true };
}

/** Logged-in form-action path: apply, then redirect into the map. */
export async function setLocationAndInterest(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/show-interest");
  const r = await applyLocationAndInterest(session.user.id, formData);
  if (!r.ok) throw new Error(r.error);
  redirect("/play");
}

/** Client path (register + signIn already done in the same form): apply and
 *  return a result so the caller can show errors / navigate itself. */
export async function saveLocationAndInterest(formData: FormData): Promise<LocationResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Please sign in first." };
  return applyLocationAndInterest(session.user.id, formData);
}
