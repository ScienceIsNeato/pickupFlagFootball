"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { areas, areaOptouts } from "@/lib/db/schema";
import { verifyDeclineToken } from "@/lib/declineLink";

/**
 * Apply a one-click "not interested in this site" opt-out. POST only (the email
 * link lands on a GET confirm page first) so link scanners / prefetchers can't
 * silently opt anyone out. The signed token is the auth — no session needed.
 */
export async function applyDecline(formData: FormData) {
  const t = String(formData.get("t") ?? "");
  const parsed = verifyDeclineToken(t);
  if (!parsed) redirect("/decline?done=invalid");

  // The area may have moved on (e.g. been recycled) — guard the FK.
  const [area] = await db.select({ id: areas.id }).from(areas)
    .where(eq(areas.id, parsed.areaId)).limit(1);
  if (!area) redirect("/decline?done=gone");

  await db.insert(areaOptouts)
    .values({ areaId: parsed.areaId, userId: parsed.userId })
    .onConflictDoNothing();
  redirect("/decline?done=ok");
}
