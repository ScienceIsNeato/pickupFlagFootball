"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, interestSignals, activityTypes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { lookupZip, cellsForPoint, ensureArea } from "@/lib/geo";
import { evaluate } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";

export async function updateAccount(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const displayName = (formData.get("displayName") as string ?? "").trim() || null;
  const city = (formData.get("city") as string ?? "").trim();
  const zip = (formData.get("zip") as string ?? "").trim();

  const update: Record<string, unknown> = {
    displayName,
    updatedAt: new Date(),
  };

  if (zip && /^\d{5}$/.test(zip)) {
    const centroid = await lookupZip(zip);
    if (!centroid) throw new Error("ZIP code not found");
    {
      const { r5, r6, r7, r8, r9, snapLat, snapLng } = cellsForPoint(centroid.lat, centroid.lng);
      const displayCity = city || centroid.city || zip;

      Object.assign(update, {
        city: displayCity,
        zip,
        homeLat: snapLat,
        homeLng: snapLng,
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
        // Account location is the user's home: move interest here. Deactivate
        // any existing signals for this activity, then (re)activate the new
        // area's — a blanket areaId update would collide on the
        // (activity, user, area) unique index when a user has several.
        await db
          .update(interestSignals)
          .set({ active: false })
          .where(and(
            eq(interestSignals.userId, session.user.id!),
            eq(interestSignals.activityTypeId, activityTypeId),
          ));
        await db
          .insert(interestSignals)
          .values({ activityTypeId, userId: session.user.id!, areaId, h3Base: r7, active: true })
          .onConflictDoUpdate({
            target: [interestSignals.activityTypeId, interestSignals.userId, interestSignals.areaId],
            set: { active: true, h3Base: r7 },
          });
        await db.update(users).set(update).where(eq(users.id, session.user.id!));
        // the move may spark the new area
        await evaluate(db as unknown as EngineDb, activityTypeId, areaId, new Date());
        redirect("/account");
      } else {
        // A valid ZIP was given but the activity isn't configured. Don't write
        // the new home while leaving interest_signals pointed at the old area —
        // that desyncs the profile from the map. Fail the whole save instead.
        throw new Error("activity not configured");
      }
    }
  } else if (city) {
    update.city = city;
  }

  await db
    .update(users)
    .set(update)
    .where(eq(users.id, session.user.id!));

  redirect("/account");
}
