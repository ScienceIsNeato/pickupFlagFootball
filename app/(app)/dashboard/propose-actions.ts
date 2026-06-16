"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  activityTypes, areas, interestSignals, formationAttempts, suggestions,
} from "@/lib/db/schema";
import { h3ToBigInt, diskCells } from "@/lib/geo/h3";

/**
 * "Propose new game here" from the map. Records a suggestion against the area's
 * live suggestion window — seeding one (a user-initiated spark) if the area
 * doesn't have an open attempt yet.
 */
export async function proposeGame(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/dashboard");

  const h3 = String(formData.get("h3") ?? "").trim();
  const place = String(formData.get("place") ?? "").trim();
  const start = String(formData.get("start") ?? "").trim();
  if (!h3 || !place || !start) throw new Error("place and time are required");

  const placeLatRaw = String(formData.get("place_lat") ?? "");
  const placeLngRaw = String(formData.get("place_lng") ?? "");
  const placeLat = placeLatRaw ? Number(placeLatRaw) : null;
  const placeLng = placeLngRaw ? Number(placeLngRaw) : null;

  const cell = h3ToBigInt(h3);
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  const [area] = await db.select().from(areas)
    .where(and(eq(areas.activityTypeId, act.id), eq(areas.h3Cell, cell))).limit(1);
  if (!area) throw new Error("no area for this spot yet");

  // A game is already scheduled here — don't undo it by spawning a new attempt.
  if (area.status === "SCHEDULED") redirect("/dashboard?propose=scheduled");

  // Find any LIVE attempt (not just SUGGESTING) so we don't collide with the
  // one-live-attempt index or demote an in-flight formation.
  const [live] = await db.select().from(formationAttempts)
    .where(and(
      eq(formationAttempts.areaId, area.id),
      inArray(formationAttempts.status, ["SUGGESTING", "COMPILING", "AVAILABILITY", "ADJUDICATING"]),
    )).limit(1);

  // Suggestions are only accepted during the suggestion window.
  if (live && live.status !== "SUGGESTING") redirect("/dashboard?propose=closed");

  let attempt = live;
  if (!attempt) {
    const disk = diskCells(area.h3Cell, 1);
    const cohort = await db.selectDistinct({ u: interestSignals.userId }).from(interestSignals)
      .where(and(eq(interestSignals.activityTypeId, act.id), eq(interestSignals.active, true),
        inArray(interestSignals.h3Base, disk)));
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${formationAttempts.attemptNumber}),0)::int` })
      .from(formationAttempts).where(eq(formationAttempts.areaId, area.id));
    const now = new Date();
    [attempt] = await db.insert(formationAttempts).values({
      activityTypeId: act.id, areaId: area.id, attemptNumber: n + 1, status: "SUGGESTING",
      catchmentCells: disk, cohortUserIds: cohort.map((r) => r.u),
      suggestionOpenedAt: now, suggestionClosesAt: new Date(now.getTime() + 48 * 3_600_000),
    }).returning();
    await db.update(areas).set({ status: "IN_FORMATION" }).where(eq(areas.id, area.id));
  }
  if (!attempt) throw new Error("could not open a suggestion window");

  await db.insert(suggestions).values({
    attemptId: attempt.id, userId: session.user.id, placeText: place,
    placeLat, placeLng, proposedStart: new Date(start),
  });

  redirect("/dashboard");
}
