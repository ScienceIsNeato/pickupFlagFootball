"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { txnDb } from "@/lib/db/pool";
import { formationAttempts, attemptInterest } from "@/lib/db/schema";
import { verifyInterestToken } from "@/lib/interestLink";
import { resolveProposal } from "@/lib/mime/trigger";

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

  const interested = parsed.action === "in";
  // Lock the attempt, re-check OPEN, and write the response in one transaction so
  // a concurrent resolve can't close it between the check and the upsert (which
  // would record a late response on an already-settled proposal).
  const outcome = await txnDb.transaction(async (tx) => {
    const [att] = await tx.select({ status: formationAttempts.status })
      .from(formationAttempts).where(eq(formationAttempts.id, parsed.attemptId)).for("update").limit(1);
    if (!att) return "invalid";
    if (att.status !== "OPEN") return "closed";
    await tx.insert(attemptInterest)
      .values({ attemptId: parsed.attemptId, userId: parsed.userId, interested })
      .onConflictDoUpdate({
        target: [attemptInterest.attemptId, attemptInterest.userId],
        set: { interested },
      });
    return "ok";
  });
  if (outcome !== "ok") redirect(`/interested?done=${outcome}`);

  // An "I'm in" can tip it over the threshold before the deadline — resolve now.
  if (interested) await resolveProposal(parsed.attemptId);
  redirect(`/interested?done=${parsed.action}`);
}
