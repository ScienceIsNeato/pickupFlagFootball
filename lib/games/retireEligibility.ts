import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { gameOccurrences } from "@/lib/db/schema";
import { RETIRE_DEAD_WEEKS, RETIRE_WINDOW_MS, tooNewToRetire } from "./retireWindow";

export type RetireCheck = { ok: true } | { ok: false; reason: string };

const TOO_NEW = `a game can only be retired after ${RETIRE_DEAD_WEEKS} straight weeks with no game — it hasn't run that long yet. pause it instead.`;
const PLAYED_RECENTLY = `a game can only be retired after ${RETIRE_DEAD_WEEKS} straight weeks with no game — it's been played in the last ${RETIRE_DEAD_WEEKS} weeks. pause it instead.`;

/** Whether a captain may retire this series now: it's existed ≥ the dead-week
 *  window AND no game has been played within that window (a recent game resets
 *  the streak). Same check the UI uses to enable/disable the retire control and
 *  the server action uses to enforce it. */
export async function retireEligibility(
  gameId: string, scheduledStart: Date | string, now = new Date(),
): Promise<RetireCheck> {
  if (tooNewToRetire(scheduledStart, now)) return { ok: false, reason: TOO_NEW };
  const cutoff = new Date(now.getTime() - RETIRE_WINDOW_MS).toISOString().slice(0, 10); // YYYY-MM-DD
  const [played] = await db.select({ id: gameOccurrences.id }).from(gameOccurrences)
    .where(and(
      eq(gameOccurrences.gameId, gameId),
      eq(gameOccurrences.status, "played"),
      gte(gameOccurrences.occurrenceDate, cutoff),
    )).limit(1);
  return played ? { ok: false, reason: PLAYED_RECENTLY } : { ok: true };
}
