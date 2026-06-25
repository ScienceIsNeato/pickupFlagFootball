import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  areas, activityTypes, formationAttempts, suggestions, formationOptions, softPromises,
  areaCaptains, users, areaOptouts,
} from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo";

export const dynamic = "force-dynamic";

const LIVE = ["SUGGESTING", "COMPILING", "AVAILABILITY", "ADJUDICATING"] as const;

type Activity =
  | { kind: "propose" | "suggest"; byName: string; placeText: string; proposedStart: string; at: string }
  | { kind: "vote";              byName: string; placeText: string; proposedStart: string; at: string };

/**
 * Details for the proposed (forming) site nearest a clicked point: where, the
 * captain(s), and an activity log built from suggestions + votes (soft-promises),
 * oldest-first. The first entry is always "site proposed by …" (the earliest
 * suggestion's user — same person the area-captain logic picks). Auth-gated.
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
  if (!act) return NextResponse.json({ site: null });

  const forming = await db.select({
    id: areas.id, city: areas.displayCity, zip: areas.displayZip,
    centerLat: areas.centerLat, centerLng: areas.centerLng,
  }).from(areas).where(and(eq(areas.activityTypeId, act.id), eq(areas.status, "IN_FORMATION")));

  // Map clicks now land on the badge's VENUE point (not the cell centroid), so
  // match each forming area by the earliest suggestion's venue when we have it.
  // Falls back to the area centroid for forming sites with no suggestions yet.
  const venueByArea = new Map<string, { lat: number; lng: number }>();
  if (forming.length) {
    const venueRows = await db.select({
      areaId: formationAttempts.areaId,
      placeLat: suggestions.placeLat,
      placeLng: suggestions.placeLng,
    })
      .from(formationAttempts)
      .innerJoin(suggestions, eq(suggestions.attemptId, formationAttempts.id))
      .where(and(
        inArray(formationAttempts.areaId, forming.map((a) => a.id)),
        inArray(formationAttempts.status, [...LIVE]),
      ))
      .orderBy(asc(suggestions.createdAt));
    for (const r of venueRows) {
      if (venueByArea.has(r.areaId)) continue; // earliest wins
      if (r.placeLat != null && r.placeLng != null) {
        venueByArea.set(r.areaId, { lat: r.placeLat, lng: r.placeLng });
      }
    }
  }

  let best: (typeof forming)[number] | null = null;
  let bestKm = 6;
  for (const a of forming) {
    const venue = venueByArea.get(a.id);
    const matchLat = venue?.lat ?? a.centerLat;
    const matchLng = venue?.lng ?? a.centerLng;
    const d = haversineKm(lat, lng, matchLat, matchLng);
    if (d < bestKm) { bestKm = d; best = a; }
  }
  if (!best) return NextResponse.json({ site: null });

  const [attempt] = await db.select({ id: formationAttempts.id, status: formationAttempts.status })
    .from(formationAttempts)
    .where(and(eq(formationAttempts.areaId, best.id), inArray(formationAttempts.status, [...LIVE])))
    .limit(1);

  // Suggestions (oldest first — the earliest is the proposer).
  const sRows = attempt
    ? await db.select({
        byName: users.displayName,
        placeText: suggestions.placeText,
        proposedStart: suggestions.proposedStart,
        recurDow: suggestions.recurDow,
        recurTime: suggestions.recurTime,
        at: suggestions.createdAt,
      }).from(suggestions)
        .innerJoin(users, eq(users.id, suggestions.userId))
        .where(eq(suggestions.attemptId, attempt.id))
        .orderBy(asc(suggestions.createdAt))
    : [];

  // Votes (soft-promises against compiled options).
  const vRows = attempt
    ? await db.select({
        byName: users.displayName,
        placeText: formationOptions.placeText,
        proposedStart: formationOptions.proposedStart,
        at: softPromises.createdAt,
      }).from(softPromises)
        .innerJoin(formationOptions, eq(formationOptions.id, softPromises.optionId))
        .innerJoin(users, eq(users.id, softPromises.userId))
        .where(eq(softPromises.attemptId, attempt.id))
    : [];

  // The earliest suggestion IS the proposal (FK chain means votes can't precede
  // a suggestion; this label survives the merge sort below since older sRows[0]
  // wins). Labeling here — not via a post-sort rewrite — avoids mislabeling a
  // vote as the proposal in any degenerate ordering.
  const activity: Activity[] = [
    ...sRows.map((r, i): Activity => ({
      kind: i === 0 ? "propose" : "suggest",
      byName: r.byName ?? "someone",
      placeText: r.placeText,
      proposedStart: new Date(r.proposedStart).toISOString(),
      at: new Date(r.at).toISOString(),
    })),
    ...vRows.map((r): Activity => ({
      kind: "vote",
      byName: r.byName ?? "someone",
      placeText: r.placeText,
      proposedStart: new Date(r.proposedStart).toISOString(),
      at: new Date(r.at).toISOString(),
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const firstPlaceText = sRows[0]?.placeText ?? null;
  // Proposer's when — the recurring weekly slot if they specified one, plus the
  // first-game datetime. Rendered prominently in the popup so the day/time is
  // visible without scanning the activity log.
  const firstWhen = sRows[0]
    ? {
        firstGameAt: new Date(sRows[0].proposedStart).toISOString(),
        recurDow: sRows[0].recurDow,
        recurTime: sRows[0].recurTime,
      }
    : null;

  const captainRows = await db.select({ name: users.displayName })
    .from(areaCaptains).innerJoin(users, eq(users.id, areaCaptains.userId))
    .where(eq(areaCaptains.areaId, best.id));
  // displayName is nullable in the schema — drop unnamed captains rather than
  // rendering "null" in the popup.
  const captains = captainRows.map((r) => r.name).filter((n): n is string => !!n);

  // Has the viewer said "not interested" in this site? Drives the popup's toggle.
  const [optedOut] = await db.select({ a: areaOptouts.areaId }).from(areaOptouts)
    .where(and(eq(areaOptouts.areaId, best.id), eq(areaOptouts.userId, session.user.id)))
    .limit(1);

  return NextResponse.json({
    site: {
      areaId: best.id, city: best.city, zip: best.zip,
      status: attempt?.status ?? null, captains, viewerOptedOut: !!optedOut,
    },
    firstPlaceText,
    firstWhen,
    activity,
  });
}
