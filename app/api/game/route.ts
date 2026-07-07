import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games, areas, activityTypes, areaCaptains, users, gameOccurrences } from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo";
import { reachableActiveGame, gameMembership } from "@/lib/db/gameMembership";
import { retireEligibility } from "@/lib/games/retireEligibility";

export const dynamic = "force-dynamic";

/**
 * Details for the existing game nearest a clicked point. Auth-gated like the map.
 * GET /api/game?lat=&lng=  → { game, recent } | { game: null }
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }

  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!act) return NextResponse.json({ game: null });

  // Active games (one per area). Pick the one nearest the click, within 6 km.
  const active = await db.select({
    id: games.id, areaId: games.areaId,
    placeText: games.placeText, placeLat: games.placeLat, placeLng: games.placeLng,
    scheduledStart: games.scheduledStart, isStanding: games.isStanding,
    recurDow: games.recurDow, recurTime: games.recurTime,
    confirmedCount: games.confirmedCount, status: games.status,
    minPlayers: games.minPlayers, areaMinPlayers: areas.minPlayersToSchedule,
    pausedUntil: games.pausedUntil, pauseNote: games.pauseNote,
    city: areas.displayCity, zip: areas.displayZip, timezone: areas.timezone,
    centerLat: areas.centerLat, centerLng: areas.centerLng,
  }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
    // Retired series still resolve here so a click on their (greyed) map badge
    // opens the RETIRED view + history instead of "no game here".
    .where(and(eq(games.activityTypeId, act.id), inArray(games.status, ["active", "paused", "retired"])));

  // Nearest game within 6 km. At (near-)identical coords (~<20 m — colocated
  // series at one venue) prefer a live series over a retired one, so a click
  // resolves to the same game the map shows live (the map badge lets an active
  // series win a shared cell). Beyond that, pure distance.
  const best = active
    .map((g) => ({ g, d: haversineKm(lat, lng, g.placeLat ?? g.centerLat, g.placeLng ?? g.centerLng) }))
    .filter((x) => x.d < 6)
    .sort((a, b) =>
      Math.abs(a.d - b.d) > 0.02
        ? a.d - b.d
        : (a.g.status === "retired" ? 1 : 0) - (b.g.status === "retired" ? 1 : 0) || a.d - b.d,
    )[0]?.g ?? null;
  if (!best) return NextResponse.json({ game: null });

  const captainRows = await db.select({ name: users.displayName })
    .from(areaCaptains).innerJoin(users, eq(users.id, areaCaptains.userId))
    .where(eq(areaCaptains.areaId, best.areaId));
  // displayName is nullable in the schema — drop unnamed captains rather than
  // rendering "null" in the popup. Mirrors the /api/proposed fix.
  const captains = captainRows.map((r) => r.name).filter((n): n is string => !!n);

  // Past 10 weeks for this game: which occurrences were played, and the headcount.
  const WEEK = 7 * 86_400_000;
  const now = Date.now();
  const since = new Date(now - 10 * WEEK);
  const history = await db.select({
    date: gameOccurrences.occurrenceDate, inCount: gameOccurrences.inCount, status: gameOccurrences.status,
  }).from(gameOccurrences)
    .where(and(
      eq(gameOccurrences.gameId, best.id),
      gte(gameOccurrences.kickoffAt, since),
      lte(gameOccurrences.kickoffAt, new Date(now)), // past only — exclude upcoming occurrences
    ));

  const weeks = Array.from({ length: 10 }, (_, i) => {
    const end = now - i * WEEK, start = end - WEEK;
    const o = history.find((h) => {
      const t = new Date(`${h.date}T00:00:00`).getTime();
      return t >= start && t < end;
    });
    const played = !!o && o.status === "played";
    return { weekStart: new Date(start).toISOString(), played, count: played ? o!.inCount : 0 };
  });

  // Retired games show a full history (the 10-week grid above can't reach a
  // long-retired series) — the last games actually played, most recent first.
  const playedHistory = best.status === "retired"
    ? await db.select({ date: gameOccurrences.occurrenceDate, inCount: gameOccurrences.inCount })
        .from(gameOccurrences)
        .where(and(eq(gameOccurrences.gameId, best.id), eq(gameOccurrences.status, "played")))
        .orderBy(desc(gameOccurrences.occurrenceDate))
        .limit(10)
    : [];

  // The viewer's standing on this game: are they a regular, can they join (their
  // radius reaches it), and the next-occurrence RSVP tallies for the popup.
  const occInputs = {
    id: best.id, isStanding: best.isStanding, recurDow: best.recurDow,
    recurTime: best.recurTime, scheduledStart: String(best.scheduledStart), timezone: best.timezone,
  };
  const [eligible, membership, myCap] = await Promise.all([
    reachableActiveGame(session.user.id, best.id),
    gameMembership(session.user.id, occInputs, new Date()),
    db.select({ u: areaCaptains.userId }).from(areaCaptains)
      .where(and(eq(areaCaptains.areaId, best.areaId), eq(areaCaptains.userId, session.user.id))).limit(1),
  ]);

  // Whether the viewing captain may retire now (4 straight dead weeks) — drives
  // the popup's retire control. Only computed for captains (the only consumers).
  const retire = myCap.length > 0 ? await retireEligibility(best.id, best.scheduledStart) : null;

  return NextResponse.json({
    game: {
      gameId: best.id,
      placeText: best.placeText, placeLat: best.placeLat, placeLng: best.placeLng,
      scheduledStart: best.scheduledStart, isStanding: best.isStanding,
      recurDow: best.recurDow, recurTime: best.recurTime,
      confirmedCount: best.confirmedCount, status: best.status,
      // Per-site min-expected-players: the captain's override (or null) plus the
      // area default it falls back to, so the popup can show "using default N".
      minPlayers: best.minPlayers, minPlayersEffective: best.minPlayers ?? best.areaMinPlayers,
      pausedUntil: best.pausedUntil, pauseNote: best.pauseNote,
      city: best.city, zip: best.zip,
      captains,
      viewerIsCaptain: myCap.length > 0,
      eligible: eligible != null,
      onRoster: membership.onRoster,
      myDefault: membership.myDefault,
      myRsvp: membership.myRsvp,
      rosterCount: membership.rosterCount,
      inCount: membership.inCount,
      nextOccurrence: membership.occurrence,
      canRetire: retire ? retire.ok : false,
      retireBlockedReason: retire && !retire.ok ? retire.reason : null,
    },
    weeks,
    playedHistory,
  });
}
