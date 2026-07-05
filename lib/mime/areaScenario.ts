import { and, desc, eq, inArray } from "drizzle-orm";
import {
  games, formationAttempts, attemptInterest, areas, areaOptouts, activityTypes, interestSignals,
} from "@/lib/db/schema";
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
  // pMin rides along on the pre-game states too: the HUD's FAQ explains "once
  // N say yes, it's on" and that N must be the area's real threshold.
  | { kind: "ambient-interest"; othersCount: number; totalCount: number; viewerIncluded: boolean; pMin: number }
  | { kind: "alone"; pMin: number };

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
  // Every non-game state needs the area's real confirm threshold (the FAQ
  // copy explains "once N say yes, it's on"), so load it once here.
  const [area] = await db.select({
    pMinOverride: areas.pMinOverride, centerLat: areas.centerLat, centerLng: areas.centerLng,
  }).from(areas).where(eq(areas.id, areaId)).limit(1);
  const t = await loadTunables(db, activityTypeId, area);

  if (open) {
    const inRows = await db.select({ userId: attemptInterest.userId }).from(attemptInterest)
      .where(and(eq(attemptInterest.attemptId, open.id), eq(attemptInterest.interested, true)));
    // Same roster rule resolveAttempt uses against pMin: an "I'm in" doesn't
    // count if that person has since opted out of this area — otherwise the HUD
    // can show a higher tally than what actually decides confirm/fail.
    const optedOut = new Set((await db.select({ userId: areaOptouts.userId }).from(areaOptouts)
      .where(eq(areaOptouts.areaId, areaId))).map((r) => r.userId));
    const roster = new Set(inRows.map((r) => r.userId).filter((u) => !optedOut.has(u)));
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
  // Known approximation: proposeGame freezes its cohort from the venue the
  // proposer actually right-clicks, which doesn't exist yet in these states —
  // so a real proposal near the area's edge can reach a slightly different
  // set than this centroid estimate. The HUD copy phrases these counts as
  // approximate ("about N", "next to no one") for exactly that reason.
  if (!area) return { kind: "alone", pMin: t.pMin };
  const cohort = await catchmentUsers(db, activityTypeId, area.centerLat, area.centerLng, areaId);
  const totalCount = new Set(cohort).size;
  const viewerIncluded = cohort.includes(viewerUserId);
  const othersCount = viewerIncluded ? totalCount - 1 : totalCount;
  if (othersCount > 0) return { kind: "ambient-interest", othersCount, totalCount, viewerIncluded, pMin: t.pMin };

  return { kind: "alone", pMin: t.pMin };
}

export type ViewerScenario = {
  scenario: AreaScenario;
  place: { city: string | null; zip: string | null } | null;
};

/**
 * Resolve a viewer's own area (their active interest signal for this
 * activity) and detect its scenario in one call. Shared by the /play page's
 * initial server render and the /api/hud poll it uses to stay live — both
 * need the exact same "which area is this viewer's home area" logic.
 */
export async function resolveViewerAreaScenario(
  db: EngineDb, activitySlug: string, viewerUserId: string,
): Promise<ViewerScenario | null> {
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, activitySlug)).limit(1);
  if (!act) return null;

  const [mine] = await db.select({ areaId: interestSignals.areaId }).from(interestSignals)
    .where(and(
      eq(interestSignals.userId, viewerUserId), eq(interestSignals.active, true),
      eq(interestSignals.activityTypeId, act.id),
    )).limit(1);
  if (!mine) return null;

  const scenario = await detectAreaScenario(db, act.id, mine.areaId, viewerUserId);
  const [area] = await db.select({ city: areas.displayCity, zip: areas.displayZip })
    .from(areas).where(eq(areas.id, mine.areaId)).limit(1);
  return { scenario, place: area ?? null };
}
