"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, activityTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lookupZip, cellsForPoint, ensureArea } from "@/lib/geo";
import { setActiveInterest } from "@/lib/db/interest";
import { txnDb } from "@/lib/db/pool";
import { evaluate } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";

export async function setLocationAndInterest(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/show-interest");

  const zip = (formData.get("zip") as string ?? "").trim();
  const city = (formData.get("city") as string ?? "").trim();
  if (!/^\d{5}$/.test(zip)) throw new Error("Invalid ZIP code");

  const centroid = await lookupZip(zip);
  if (!centroid) throw new Error("ZIP code not found");

  const { r5, r6, r7, r8, r9, snapLat, snapLng } = cellsForPoint(centroid.lat, centroid.lng);

  const displayCity = city || centroid.city || zip;

  // Update user location
  await db
    .update(users)
    .set({
      city: displayCity,
      zip,
      homeLat: snapLat,
      homeLng: snapLng,
      h3R5: r5,
      h3R6: r6,
      h3R7: r7,
      h3R8: r8,
      h3R9: r9,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  // Resolve flag-football activity type
  const activity = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football"))
    .limit(1);
  if (!activity.length) throw new Error("Activity type not seeded");
  const activityTypeId = activity[0].id;

  // Lazy-create the area for this H3 cell
  const areaId = await ensureArea(activityTypeId, r7, {
    city: displayCity,
    zip,
    centerLat: snapLat,
    centerLng: snapLng,
  });

  // One active location per user: (re)activate this area's signal and
  // deactivate any prior ones — done in a single atomic statement so we can't
  // strand the user with zero active interest on neon-http (no transactions).
  await setActiveInterest(activityTypeId, session.user.id, areaId, r7);

  // run the engine: this new interest may cross n_spark and open a window
  // (transactional spark — needs the pooled client)
  await evaluate(txnDb as unknown as EngineDb, activityTypeId, areaId, new Date());

  redirect("/dashboard");
}
