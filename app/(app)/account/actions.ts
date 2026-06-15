"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, interestSignals, activityTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lookupZip, cellsForPoint, ensureArea } from "@/lib/geo";

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
    if (centroid) {
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
        await ensureArea(activityTypeId, r7, {
          city: displayCity,
          zip,
          centerLat: snapLat,
          centerLng: snapLng,
        });
        // If the user already has an interest signal, update its h3Base for the new location
        await db
          .update(interestSignals)
          .set({ h3Base: r7 })
          .where(
            eq(interestSignals.userId, session.user.id!)
          );
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
