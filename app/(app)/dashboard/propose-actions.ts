"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  activityTypes, areas, interestSignals, formationAttempts, suggestions,
} from "@/lib/db/schema";
import { h3ToBigInt, diskCells } from "@/lib/geo/h3";
import { shouldRetrigger } from "@/lib/mime";
import { loadTunables } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";

const edb = () => db as unknown as EngineDb;
function coord(raw: string, lo: number, hi: number): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/**
 * "Propose new game here" from the map. Records a suggestion against the area's
 * live suggestion window — seeding one (a user-initiated spark) if the area
 * doesn't have an open attempt yet.
 */
export async function proposeGame(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/dashboard");

  const h3 = String(formData.get("h3") ?? "").trim();
  const place = String(formData.get("place") ?? "").trim();
  const start = String(formData.get("start") ?? "").trim();
  if (!h3 || !place || !start) throw new Error("place and time are required");
  const when = new Date(start);
  if (Number.isNaN(when.getTime())) throw new Error("invalid time");

  const placeLat = coord(String(formData.get("place_lat") ?? ""), -90, 90);
  const placeLng = coord(String(formData.get("place_lng") ?? ""), -180, 180);

  const cell = h3ToBigInt(h3);
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!act) throw new Error("activity not configured");
  const [area] = await db.select().from(areas)
    .where(and(eq(areas.activityTypeId, act.id), eq(areas.h3Cell, cell))).limit(1);
  if (!area) throw new Error("no area for this spot yet");

  const disk = diskCells(area.h3Cell, 1);

  // Only locals (people who showed interest in this catchment) may propose.
  const [mine] = await db.select({ id: interestSignals.id }).from(interestSignals)
    .where(and(
      eq(interestSignals.activityTypeId, act.id),
      eq(interestSignals.userId, session.user.id),
      eq(interestSignals.active, true),
      inArray(interestSignals.h3Base, disk),
    )).limit(1);
  if (!mine) redirect("/dashboard?propose=notlocal");

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
    const t = await loadTunables(edb(), act.id, area);
    const cohort = await db.selectDistinct({ u: interestSignals.userId }).from(interestSignals)
      .where(and(eq(interestSignals.activityTypeId, act.id), eq(interestSignals.active, true),
        inArray(interestSignals.h3Base, disk)));
    const now = new Date();
    // A stalled area is in cooldown — respect the backoff like the engine does,
    // don't let a manual propose re-open it early.
    if (area.status === "STALLED" &&
        !shouldRetrigger(now, area.nextTriggerAt ?? null, area.nextTriggerInterest ?? null, cohort.length)) {
      redirect("/dashboard?propose=cooldown");
    }
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${formationAttempts.attemptNumber}),0)::int` })
      .from(formationAttempts).where(eq(formationAttempts.areaId, area.id));
    try {
      [attempt] = await db.insert(formationAttempts).values({
        activityTypeId: act.id, areaId: area.id, attemptNumber: n + 1, status: "SUGGESTING",
        catchmentCells: disk, cohortUserIds: cohort.map((r) => r.u),
        suggestionOpenedAt: now, suggestionClosesAt: new Date(now.getTime() + t.suggestWindowH * 3_600_000),
      }).returning();
      await db.update(areas).set({ status: "IN_FORMATION" }).where(eq(areas.id, area.id));
    } catch (e) {
      // Only the one-live-attempt conflict is expected (a concurrent propose).
      const msg = e instanceof Error ? e.message : String(e);
      if (!/uq_one_live_attempt|unique|duplicate|23505/i.test(msg)) throw e;
      // attach to the window the winner just opened
      [attempt] = await db.select().from(formationAttempts)
        .where(and(eq(formationAttempts.areaId, area.id), eq(formationAttempts.status, "SUGGESTING")))
        .limit(1);
    }
  }
  if (!attempt) redirect("/dashboard?propose=retry");

  await db.insert(suggestions).values({
    attemptId: attempt.id, userId: session.user.id, placeText: place,
    placeLat, placeLng, proposedStart: when,
  });

  redirect("/dashboard");
}
