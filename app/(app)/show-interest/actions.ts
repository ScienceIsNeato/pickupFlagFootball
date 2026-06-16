"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, activityTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lookupZip, cellsForPoint, ensureArea } from "@/lib/geo";
import { setActiveInterest } from "@/lib/db/interest";
import { txnDb } from "@/lib/db/pool";
import { evaluate } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";

function coord(raw: FormDataEntryValue | null, lo: number, hi: number): number | null {
  const s = String(raw ?? "").trim();
  const n = Number(s);
  return s && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

export async function setLocationAndInterest(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/show-interest");

  const zip = (formData.get("zip") as string ?? "").trim();
  const city = (formData.get("city") as string ?? "").trim();
  if (!/^\d{5}$/.test(zip)) throw new Error("Invalid ZIP code");

  const centroid = await lookupZip(zip);
  if (!centroid) throw new Error("ZIP code not found");

  // Optional precise address (from the LocationPicker). When given, everything
  // is keyed off the actual address for accurate distance + cell bucketing;
  // otherwise the ZIP centroid.
  const addrLat = coord(formData.get("home_addr_lat"), -90, 90);
  const addrLng = coord(formData.get("home_addr_lng"), -180, 180);
  const hasAddr = addrLat !== null && addrLng !== null;
  const baseLat = hasAddr ? addrLat : centroid.lat;
  const baseLng = hasAddr ? addrLng : centroid.lng;

  const { r5, r6, r7, r8, r9, snapLat, snapLng } = cellsForPoint(baseLat, baseLng);
  // Home point stored on the user: the precise address if they gave one, else
  // the ZIP-centroid snap. The shared area is always keyed to the r7 cell
  // centroid (snapLat/snapLng), never a user's address.
  const homeLat = hasAddr ? addrLat : snapLat;
  const homeLng = hasAddr ? addrLng : snapLng;

  const displayCity = city || centroid.city || zip;

  // Update user location
  await db
    .update(users)
    .set({
      city: displayCity,
      zip,
      homeLat,
      homeLng,
      h3R5: r5,
      h3R6: r6,
      h3R7: r7,
      h3R8: r8,
      h3R9: r9,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  // Resolve flag-football activity type
  const activity = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football"))
    .limit(1);
  if (!activity.length) throw new Error("Activity type not seeded");
  const activityTypeId = activity[0].id;

  // Lazy-create the area for this H3 cell
  const areaId = await ensureArea(activityTypeId, r7, {
    city: displayCity,
    zip,
    centerLat: snapLat,
    centerLng: snapLng,
  });

  // One active location per user: (re)activate this area's signal and
  // deactivate any prior ones — done in a single atomic statement so we can't
  // strand the user with zero active interest on neon-http (no transactions).
  await setActiveInterest(activityTypeId, session.user.id, areaId, r7);

  // run the engine: this new interest may cross n_spark and open a window
  // (transactional spark — needs the pooled client)
  await evaluate(txnDb as unknown as EngineDb, activityTypeId, areaId, new Date());

  redirect("/dashboard");
}
