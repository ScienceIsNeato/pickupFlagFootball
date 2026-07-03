import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { games, formationAttempts, attemptInterest, areas } from "@/lib/db/schema";
import { catchmentUsers, loadTunables, type EngineDb } from "./engine";

/**
 * The map HUD's "what's my situation, what do I do next" signal. Checked in
 * priority order — a live game outranks a proposal, which outranks bare
 * interest, which outranks being the only one here. Every number returned is
 * read live (games, the open attempt's tally, the real catchment) — nothing
 * here is a hardcoded copy number, so tuning pMin or adding a game never
 * makes the HUD lie.
 */
export type AreaScenario =
  | { kind: "games"; count: number; placeText: string | null }
  | { kind: "open-proposal"; interestedCount: number; pMin: number; closesAt: string; placeText: string }
  | { kind: "ambient-interest"; othersCount: number; totalCount: number }
  | { kind: "alone" };

/** `areaId` is the viewer's own area (their home interest signal's area) — the
 *  HUD describes what's happening in the viewer's own neighborhood. */
export async function detectAreaScenario(
  db: EngineDb, activityTypeId: string, areaId: string, viewerUserId: string, now = new Date(),
): Promise<AreaScenario> {
  // 1. A live standing game already claims this area — nothing else matters.
  const liveGames = await db.select({ id: games.id, placeText: games.placeText })
    .from(games)
    .where(and(eq(games.areaId, areaId), inArray(games.status, ["active", "paused"])));
  if (liveGames.length > 0) {
    return {
      kind: "games",
      count: liveGames.length,
      placeText: liveGames.length === 1 ? liveGames[0].placeText.split(" — ")[0] : null,
    };
  }

  // 2. A proposal is open right now — the most actionable moment (a closing
  // window), so it outranks quietly-ambient interest even though both can be
  // true at once.
  const [open] = await db.select().from(formationAttempts)
    .where(and(
      eq(formationAttempts.areaId, areaId),
      eq(formationAttempts.status, "OPEN"),
      gt(formationAttempts.interestClosesAt, now),
    ))
    .orderBy(desc(formationAttempts.createdAt))
    .limit(1);
  if (open) {
    const inRows = await db.select({ userId: attemptInterest.userId }).from(attemptInterest)
      .where(and(eq(attemptInterest.attemptId, open.id), eq(attemptInterest.interested, true)));
    const [area] = await db.select({ pMinOverride: areas.pMinOverride }).from(areas)
      .where(eq(areas.id, areaId)).limit(1);
    const t = await loadTunables(db, activityTypeId, area);
    return {
      kind: "open-proposal",
      interestedCount: new Set(inRows.map((r) => r.userId)).size,
      pMin: t.pMin,
      closesAt: open.interestClosesAt.toISOString(),
      placeText: open.placeText.split(" — ")[0],
    };
  }

  // 3. No live game, no open proposal — how many people would a proposal here
  // actually reach? Same reachability rule the propose flow itself uses
  // (catchmentUsers), measured from the area's centroid so everyone sharing
  // this area sees the same number regardless of their exact home point.
  const [area] = await db.select({ centerLat: areas.centerLat, centerLng: areas.centerLng })
    .from(areas).where(eq(areas.id, areaId)).limit(1);
  if (!area) return { kind: "alone" };
  const cohort = await catchmentUsers(db, activityTypeId, area.centerLat, area.centerLng, areaId);
  const totalCount = new Set(cohort).size;
  const othersCount = cohort.includes(viewerUserId) ? totalCount - 1 : totalCount;
  if (othersCount > 0) return { kind: "ambient-interest", othersCount, totalCount };

  return { kind: "alone" };
}
