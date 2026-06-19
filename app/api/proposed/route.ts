import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  areas, activityTypes, formationAttempts, suggestions, formationOptions, softPromises,
  areaCaptains, users,
} from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo";

export const dynamic = "force-dynamic";

const LIVE = ["SUGGESTING", "COMPILING", "AVAILABILITY", "ADJUDICATING"] as const;

/**
 * Details for the proposed (forming) site nearest a clicked point: where it is,
 * what's been suggested, and — once voting opens — the options with their vote
 * (soft-promise) tallies. Auth-gated like the map.
 * GET /api/proposed?lat=&lng=  → { site, suggestions, options } | { site: null }
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
  if (!act) return NextResponse.json({ site: null });

  const forming = await db.select({
    id: areas.id, city: areas.displayCity, zip: areas.displayZip,
    centerLat: areas.centerLat, centerLng: areas.centerLng,
  }).from(areas).where(and(eq(areas.activityTypeId, act.id), eq(areas.status, "IN_FORMATION")));

  let best: (typeof forming)[number] | null = null;
  let bestKm = 6;
  for (const a of forming) {
    const d = haversineKm(lat, lng, a.centerLat, a.centerLng);
    if (d < bestKm) { bestKm = d; best = a; }
  }
  if (!best) return NextResponse.json({ site: null });

  const [attempt] = await db.select({ id: formationAttempts.id, status: formationAttempts.status })
    .from(formationAttempts)
    .where(and(eq(formationAttempts.areaId, best.id), inArray(formationAttempts.status, [...LIVE])))
    .limit(1);

  const suggs = attempt
    ? await db.select({ placeText: suggestions.placeText, proposedStart: suggestions.proposedStart })
        .from(suggestions).where(eq(suggestions.attemptId, attempt.id))
        .orderBy(asc(suggestions.createdAt))
    : [];

  // Options with their vote (soft-promise) counts — the "recent vote info".
  const opts = attempt
    ? await db.select({
        placeText: formationOptions.placeText, proposedStart: formationOptions.proposedStart,
        votes: sql<number>`count(${softPromises.id})::int`,
      }).from(formationOptions)
        .leftJoin(softPromises, eq(softPromises.optionId, formationOptions.id))
        .where(eq(formationOptions.attemptId, attempt.id))
        .groupBy(formationOptions.id)
        .orderBy(desc(sql`count(${softPromises.id})`))
    : [];

  const captainRows = await db.select({ name: users.displayName })
    .from(areaCaptains).innerJoin(users, eq(users.id, areaCaptains.userId))
    .where(eq(areaCaptains.areaId, best.id));
  const captains = captainRows.map((r) => r.name);

  return NextResponse.json({
    site: { city: best.city, zip: best.zip, status: attempt?.status ?? null, captains },
    suggestions: suggs,
    options: opts,
  });
}
