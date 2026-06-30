"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { txnDb } from "@/lib/db/pool";
import { formationAttempts, attemptInterest, areas, areaOptouts, users } from "@/lib/db/schema";
import { verifyInterestToken } from "@/lib/interestLink";
import { resolveProposal } from "@/lib/mime/trigger";
import { haversineKm } from "@/lib/geo/distance";

/**
 * Apply a one-click Interested / Not-Interested response to a proposal. POST only
 * (the email link lands on a GET confirmation page first) so prefetchers can't
 * record a response. "in" = interested (counts + rosters you if it forms);
 * "out" = not interested in THIS proposal.
 */
export async function applyInterest(formData: FormData) {
  const t = String(formData.get("t") ?? "");
  const parsed = verifyInterestToken(t);
  if (!parsed) redirect("/interested?done=invalid");

  // Eligibility (same gate as the in-app respondInterest): the responder's travel
  // radius must reach the venue, or the area centroid when the proposal has no
  // exact coords. Catches a one-click link clicked after the recipient moved out
  // of range, so the link can't count an out-of-area user toward formation.
  const [elig] = await txnDb.select({
    lat: formationAttempts.placeLat, lng: formationAttempts.placeLng,
    areaLat: areas.centerLat, areaLng: areas.centerLng,
  }).from(formationAttempts).leftJoin(areas, eq(areas.id, formationAttempts.areaId))
    .where(eq(formationAttempts.id, parsed.attemptId)).limit(1);
  const vLat = elig?.lat ?? elig?.areaLat;
  const vLng = elig?.lng ?? elig?.areaLng;
  if (vLat != null && vLng != null) {
    const [me] = await txnDb.select({ lat: users.homeLat, lng: users.homeLng, km: users.maxTravelKm })
      .from(users).where(eq(users.id, parsed.userId)).limit(1);
    if (me?.lat != null && me?.lng != null && haversineKm(me.lat, me.lng, vLat, vLng) > (me.km ?? 24.14)) {
      redirect("/interested?done=outofrange");
    }
  }

  const interested = parsed.action === "in";
  // Lock the attempt, re-check OPEN, and write the response in one transaction so
  // a concurrent resolve can't close it between the check and the upsert (which
  // would record a late response on an already-settled proposal).
  const outcome = await txnDb.transaction(async (tx) => {
    const [att] = await tx.select({ status: formationAttempts.status, areaId: formationAttempts.areaId })
      .from(formationAttempts).where(eq(formationAttempts.id, parsed.attemptId)).for("update").limit(1);
    if (!att) return "invalid";
    if (att.status !== "OPEN") return "closed";
    await tx.insert(attemptInterest)
      .values({ attemptId: parsed.attemptId, userId: parsed.userId, interested })
      .onConflictDoUpdate({
        target: [attemptInterest.attemptId, attemptInterest.userId],
        set: { interested },
      });
    // "Interested" re-engages you with the area — clear any opt-out so you count,
    // matching the in-app respondInterest. A per-proposal "not interested" doesn't.
    if (interested) {
      await tx.delete(areaOptouts).where(and(eq(areaOptouts.areaId, att.areaId), eq(areaOptouts.userId, parsed.userId)));
    }
    return "ok";
  });
  if (outcome !== "ok") redirect(`/interested?done=${outcome}`);

  // An "I'm in" can tip it over the threshold before the deadline — resolve now.
  if (interested) await resolveProposal(parsed.attemptId);
  redirect(`/interested?done=${parsed.action}`);
}
