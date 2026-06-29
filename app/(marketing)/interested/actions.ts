"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
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

  const [att] = await db.select({ status: formationAttempts.status })
    .from(formationAttempts).where(eq(formationAttempts.id, parsed.attemptId)).limit(1);
  if (!att) redirect("/interested?done=invalid");
  if (att.status !== "OPEN") redirect("/interested?done=closed");

  const interested = parsed.action === "in";
  await db.insert(attemptInterest)
    .values({ attemptId: parsed.attemptId, userId: parsed.userId, interested })
    .onConflictDoUpdate({
      target: [attemptInterest.attemptId, attemptInterest.userId],
      set: { interested },
    });

  // An "I'm in" can tip it over the threshold before the deadline — resolve now.
  if (interested) await resolveProposal(parsed.attemptId);
  redirect(`/interested?done=${parsed.action}`);
}
