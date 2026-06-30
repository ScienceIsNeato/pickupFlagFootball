import { eq } from "drizzle-orm";
import { txnDb } from "@/lib/db/pool";
import { formationAttempts } from "@/lib/db/schema";
import { resolveAttempt } from "./engine";
import { evaluateOccurrence } from "./occurrences";
import type { EngineDb } from "./engine";

/**
 * Event-driven entry to the MIME engine, fired the moment a user action changes
 * relevant state so the work happens in-request instead of waiting for a tick.
 *
 * Contract (matches the scheduled path): idempotent and **non-fatal** — an engine
 * error here must never fail the user action that triggered it; the cron is the
 * backstop that catches anything an event misses or that errors out.
 */

/** Re-resolve one proposal now (someone just responded). An early "I'm in" that
 *  clears the threshold can form the game before the deadline. */
export async function resolveProposal(attemptId: string): Promise<void> {
  try {
    // Wrap in a transaction like the cron path (tick): the OPEN→CONFIRMED claim,
    // the game/roster inserts, and the notifications are all-or-nothing, so a
    // mid-flight error rolls the claim back instead of leaving a confirmed attempt
    // with no game that the cron will never retry.
    await txnDb.transaction(async (tx) => {
      const db = tx as unknown as EngineDb;
      const [att] = await db.select().from(formationAttempts).where(eq(formationAttempts.id, attemptId)).limit(1);
      if (att) await resolveAttempt(db, att, new Date());
    });
  } catch (e) {
    console.error("[mime] resolveProposal failed (cron will retry)", {
      attemptId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Re-run the occurrence FSM for one game now (its roster or lifecycle just
 *  changed — a join, a captain resume/pause/retire). */
export async function runOccurrence(gameId: string): Promise<void> {
  try {
    await evaluateOccurrence(txnDb as unknown as EngineDb, gameId, new Date());
  } catch (e) {
    console.error("[mime] runOccurrence failed (cron will retry)", {
      gameId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
