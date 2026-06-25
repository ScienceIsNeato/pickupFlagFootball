import { and, eq, gte, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { gameOccurrences } from "@/lib/db/schema";
import { toYMD } from "@/lib/datetime";
import { RETIRE_DEAD_WEEKS, RETIRE_WINDOW_MS, tooNewToRetire } from "./retireWindow";

export type RetireCheck = { ok: true } | { ok: false; reason: string };

const TOO_NEW = `a game can only be retired after ${RETIRE_DEAD_WEEKS} straight weeks with no game — it hasn't run that long yet. pause it instead.`;
const PLAYED_RECENTLY = `a game can only be retired after ${RETIRE_DEAD_WEEKS} straight weeks with no game — there's been a game in the last ${RETIRE_DEAD_WEEKS} weeks. pause it instead.`;

// A week counts as "no game" only if its occurrence is skipped or cancelled.
// Everything else — played, or still on the way (scheduled / notifying /
// awaiting_game) or mid-poll (pending / polling / tallying) — means a game
// happened or is happening, so it blocks retirement (and stops a retire from
// cancelling a live/just-played week).
const NO_GAME_STATUSES = ["skipped", "cancelled"] as const;

/** Whether a captain may retire this series now: it's existed ≥ the dead-week
 *  window AND no game has been played within that window (a recent game resets
 *  the streak). Same check the UI uses to enable/disable the retire control and
 *  the server action uses to enforce it. */
export async function retireEligibility(
  gameId: string, scheduledStart: Date | string, now = new Date(),
): Promise<RetireCheck> {
  if (tooNewToRetire(scheduledStart, now)) return { ok: false, reason: TOO_NEW };
  // Local calendar day (occurrence_date is a local day via toYMD — a UTC cutoff
  // could be off by one near midnight and misjudge a recent week).
  const cutoff = toYMD(new Date(now.getTime() - RETIRE_WINDOW_MS));
  const [recent] = await db.select({ id: gameOccurrences.id }).from(gameOccurrences)
    .where(and(
      eq(gameOccurrences.gameId, gameId),
      notInArray(gameOccurrences.status, [...NO_GAME_STATUSES]),
      gte(gameOccurrences.occurrenceDate, cutoff),
    )).limit(1);
  return recent ? { ok: false, reason: PLAYED_RECENTLY } : { ok: true };
}
