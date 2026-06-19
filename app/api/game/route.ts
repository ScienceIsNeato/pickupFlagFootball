import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games, areas, activityTypes } from "@/lib/db/schema";
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
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

  const recent = await db.select({
    scheduledStart: games.scheduledStart, placeText: games.placeText,
    confirmedCount: games.confirmedCount, status: games.status,
  }).from(games).where(eq(games.areaId, best.areaId))
    .orderBy(desc(games.scheduledStart)).limit(6);

  return NextResponse.json({
    game: {
      placeText: best.placeText, placeLat: best.placeLat, placeLng: best.placeLng,
      scheduledStart: best.scheduledStart, isStanding: best.isStanding,
      recurDow: best.recurDow, recurTime: best.recurTime,
      confirmedCount: best.confirmedCount, status: best.status,
      city: best.city, zip: best.zip,
    },
    recent,
  });
}
