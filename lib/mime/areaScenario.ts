import { and, desc, eq, inArray } from "drizzle-orm";
import { games, formationAttempts, attemptInterest, areas, areaOptouts } from "@/lib/db/schema";
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
  // viewerIncluded: whether the viewer themselves is one of totalCount — false
  // in edge cases catchmentUsers excludes them (emailOptIn off, or an area
  // opt-out on their own home area). The share copy must not claim "including
  // me" when that's not actually true.
  | { kind: "ambient-interest"; othersCount: number; totalCount: number; viewerIncluded: boolean }
  | { kind: "alone" };

/** `areaId` is the viewer's own area (their home interest signal's area) — the
 *  HUD describes what's happening in the viewer's own neighborhood. */
export async function detectAreaScenario(
  db: EngineDb, activityTypeId: string, areaId: string, viewerUserId: string,
): Promise<AreaScenario> {
  // 1. A live STANDING game already claims this area — nothing else matters.
  // isStanding excludes a one-off (non-recurring) confirmed game, which
  // shouldn't get the "runs weekly here" copy; activityTypeId guards against
  // cross-activity leakage if the DB ever has inconsistent rows.
  const liveGames = await db.select({ id: games.id, placeText: games.placeText })
    .from(games)
    .where(and(
      eq(games.areaId, areaId), eq(games.activityTypeId, activityTypeId),
      eq(games.isStanding, true), inArray(games.status, ["active", "paused"]),
    ));
  if (liveGames.length > 0) {
    return {
      kind: "games",
      count: liveGames.length,
      placeText: liveGames.length === 1 ? liveGames[0].placeText.split(" — ")[0] : null,
    };
  }

  // 2. A proposal is open right now — the most actionable moment (a closing
  // window), so it outranks quietly-ambient interest even though both can be
  // true at once. Matched purely on status='OPEN' (not also interestClosesAt
  // > now): the map's own "forming" badge is driven by status alone, so an
  // attempt whose deadline just passed but hasn't been resolved yet (the gap
  // before the next cron tick / event-driven resolve) must show the SAME
  // "open-proposal" state here — otherwise the HUD says "nobody's proposed a
  // spot yet" while the map still shows the badge for that exact attempt.
  const [open] = await db.select().from(formationAttempts)
    .where(and(
      eq(formationAttempts.areaId, areaId),
      eq(formationAttempts.activityTypeId, activityTypeId),
      eq(formationAttempts.status, "OPEN"),
    ))
    .orderBy(desc(formationAttempts.createdAt))
    .limit(1);
  if (open) {
    const inRows = await db.select({ userId: attemptInterest.userId }).from(attemptInterest)
      .where(and(eq(attemptInterest.attemptId, open.id), eq(attemptInterest.interested, true)));
    // Same roster rule resolveAttempt uses against pMin: an "I'm in" doesn't
    // count if that person has since opted out of this area — otherwise the HUD
    // can show a higher tally than what actually decides confirm/fail.
    const optedOut = new Set((await db.select({ userId: areaOptouts.userId }).from(areaOptouts)
      .where(eq(areaOptouts.areaId, areaId))).map((r) => r.userId));
    const roster = new Set(inRows.map((r) => r.userId).filter((u) => !optedOut.has(u)));
    const [area] = await db.select({ pMinOverride: areas.pMinOverride }).from(areas)
      .where(eq(areas.id, areaId)).limit(1);
    const t = await loadTunables(db, activityTypeId, area);
    return {
      kind: "open-proposal",
      interestedCount: roster.size,
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
  const viewerIncluded = cohort.includes(viewerUserId);
  const othersCount = viewerIncluded ? totalCount - 1 : totalCount;
  if (othersCount > 0) return { kind: "ambient-interest", othersCount, totalCount, viewerIncluded };

  return { kind: "alone" };
}
