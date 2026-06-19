import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games, areas, activityTypes, areaCaptains, users } from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo";

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
    city: areas.displayCity, zip: areas.displayZip,
    centerLat: areas.centerLat, centerLng: areas.centerLng,
  }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
    .where(and(eq(games.activityTypeId, act.id), inArray(games.status, ["STAGED", "STANDING"])));

  let best: (typeof active)[number] | null = null;
  let bestKm = 6;
  for (const g of active) {
    const glat = g.placeLat ?? g.centerLat;
    const glng = g.placeLng ?? g.centerLng;
    const d = haversineKm(lat, lng, glat, glng);
    if (d < bestKm) { bestKm = d; best = g; }
  }
  if (!best) return NextResponse.json({ game: null });

  const captainRows = await db.select({ name: users.displayName })
    .from(areaCaptains).innerJoin(users, eq(users.id, areaCaptains.userId))
    .where(eq(areaCaptains.areaId, best.areaId));
  const captains = captainRows.map((r) => r.name);

  // Past 10 weeks for this site: was a game played, and how many said they'd come.
  const WEEK = 7 * 86_400_000;
  const now = Date.now();
  const since = new Date(now - 10 * WEEK);
  const history = await db.select({
    scheduledStart: games.scheduledStart, confirmedCount: games.confirmedCount, status: games.status,
  }).from(games)
    .where(and(eq(games.areaId, best.areaId), gte(games.scheduledStart, since)))
    .orderBy(desc(games.scheduledStart));

  const weeks = Array.from({ length: 10 }, (_, i) => {
    const end = now - i * WEEK, start = end - WEEK;
    const g = history.find((h) => {
      const t = new Date(h.scheduledStart).getTime();
      return t >= start && t < end;
    });
    const played = !!g && g.status !== "CANCELLED";
    return { weekStart: new Date(start).toISOString(), played, count: played ? g!.confirmedCount : 0 };
  });

  return NextResponse.json({
    game: {
      placeText: best.placeText, placeLat: best.placeLat, placeLng: best.placeLng,
      scheduledStart: best.scheduledStart, isStanding: best.isStanding,
      recurDow: best.recurDow, recurTime: best.recurTime,
      confirmedCount: best.confirmedCount, status: best.status,
      city: best.city, zip: best.zip,
      captains,
    },
    weeks,
  });
}
