import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formationAttempts, attemptInterest, areaCaptains, users } from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * Details for the OPEN proposal nearest a clicked point: its spot/day/time, the
 * proposer + captains, how many are interested so far, the viewer's own response,
 * and when the interest window closes. Each proposal is independent, so this is
 * one proposal — not an area-wide aggregate. Auth-gated.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }

  // Every live proposal + its proposer; pick the nearest by venue within 6km.
  const open = await db.select({
    id: formationAttempts.id, areaId: formationAttempts.areaId,
    placeText: formationAttempts.placeText, placeLat: formationAttempts.placeLat, placeLng: formationAttempts.placeLng,
    proposedStart: formationAttempts.proposedStart, recurDow: formationAttempts.recurDow, recurTime: formationAttempts.recurTime,
    interestClosesAt: formationAttempts.interestClosesAt, proposerName: users.displayName,
  }).from(formationAttempts)
    .innerJoin(users, eq(users.id, formationAttempts.proposerId))
    .where(eq(formationAttempts.status, "OPEN"));

  let best: (typeof open)[number] | null = null;
  let bestKm = 6;
  for (const a of open) {
    if (a.placeLat == null || a.placeLng == null) continue;
    const d = haversineKm(lat, lng, a.placeLat, a.placeLng);
    if (d < bestKm) { bestKm = d; best = a; }
  }
  if (!best) return NextResponse.json({ proposal: null });

  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(attemptInterest)
    .where(and(eq(attemptInterest.attemptId, best.id), eq(attemptInterest.interested, true)));
  const [mine] = await db.select({ interested: attemptInterest.interested }).from(attemptInterest)
    .where(and(eq(attemptInterest.attemptId, best.id), eq(attemptInterest.userId, session.user.id))).limit(1);
  const capRows = await db.select({ name: users.displayName }).from(areaCaptains)
    .innerJoin(users, eq(users.id, areaCaptains.userId)).where(eq(areaCaptains.areaId, best.areaId));
  const captains = capRows.map((r) => r.name).filter((n): n is string => !!n);

  return NextResponse.json({
    proposal: {
      attemptId: best.id, areaId: best.areaId, placeText: best.placeText,
      proposedStart: new Date(best.proposedStart).toISOString(),
      recurDow: best.recurDow, recurTime: best.recurTime,
      interestClosesAt: new Date(best.interestClosesAt).toISOString(),
      proposerName: best.proposerName, interestCount: c,
      viewerInterested: mine ? mine.interested : null,
      captains,
    },
  });
}
