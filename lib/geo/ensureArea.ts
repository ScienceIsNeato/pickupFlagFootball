import tzLookup from "tz-lookup";
import { db } from "@/lib/db";
import { areas } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function ensureArea(
  activityTypeId: string,
  h3R7: bigint,
  display: { city: string; zip: string; centerLat: number; centerLng: number }
): Promise<string> {
  const inserted = await db
    .insert(areas)
    .values({
      activityTypeId,
      h3Cell: h3R7,
      displayCity: display.city,
      displayZip: display.zip,
      centerLat: display.centerLat,
      centerLng: display.centerLng,
      // The area's IANA zone from its centroid — the occurrence engine uses this
      // to fire kickoff/poll windows in local time. tz-lookup is offline (bundled
      // boundary data), so no network call.
      timezone: tzLookup(display.centerLat, display.centerLng),
    })
    .onConflictDoNothing()
    .returning({ id: areas.id });

  if (inserted.length > 0) return inserted[0].id;

  const existing = await db
    .select({ id: areas.id })
    .from(areas)
    .where(
      and(eq(areas.activityTypeId, activityTypeId), eq(areas.h3Cell, h3R7))
    )
    .limit(1);

  return existing[0].id;
}
