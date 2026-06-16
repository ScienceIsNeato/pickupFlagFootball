"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, activityTypes, interestSignals } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { lookupZip, cellsForPoint, ensureArea } from "@/lib/geo";
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

  // One active location per user: deactivate any prior signals for this
  // activity, then (re)activate this area's — avoids over-counting interest
  // and duplicate active rows.
  await db
    .update(interestSignals)
    .set({ active: false })
    .where(and(
      eq(interestSignals.userId, session.user.id),
      eq(interestSignals.activityTypeId, activityTypeId),
    ));
  await db
    .insert(interestSignals)
    .values({ activityTypeId, userId: session.user.id, areaId, h3Base: r7, active: true })
    .onConflictDoUpdate({
      target: [interestSignals.activityTypeId, interestSignals.userId, interestSignals.areaId],
      set: { active: true, h3Base: r7 },
    });

  // run the engine: this new interest may cross n_spark and open a window
  await evaluate(db as unknown as EngineDb, activityTypeId, areaId, new Date());

  redirect("/dashboard");
}
