import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  areas, activityTypes, formationAttempts, suggestions, formationOptions, softPromises,
  areaCaptains, users,
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

  // Suggestions (oldest first — the earliest is the proposer).
  const sRows = attempt
    ? await db.select({
        byName: users.displayName,
        placeText: suggestions.placeText,
        proposedStart: suggestions.proposedStart,
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

  const captainRows = await db.select({ name: users.displayName })
    .from(areaCaptains).innerJoin(users, eq(users.id, areaCaptains.userId))
    .where(eq(areaCaptains.areaId, best.id));
  // displayName is nullable in the schema — drop unnamed captains rather than
  // rendering "null" in the popup.
  const captains = captainRows.map((r) => r.name).filter((n): n is string => !!n);

  return NextResponse.json({
    site: { city: best.city, zip: best.zip, status: attempt?.status ?? null, captains },
    firstPlaceText,
    activity,
  });
}
