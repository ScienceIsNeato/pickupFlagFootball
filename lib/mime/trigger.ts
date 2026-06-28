import { txnDb } from "@/lib/db/pool";
import { evaluate } from "./engine";
import { evaluateOccurrence } from "./occurrences";
import type { EngineDb } from "./engine";

/**
 * Event-driven entry to the MIME FSM. The same engine the cron runs, fired the
 * moment a user action changes the relevant state (interest in an area, a game's
 * roster/lifecycle) so transitions happen in-request instead of waiting up to a
 * tick.
 *
 * Contract (matches the scheduled path): idempotent — the FSM reconciles current
 * state and assumes prior runs cleaned up after themselves — and **non-fatal**:
 * an engine error here must never fail the user action that triggered it. The
 * cron is the backstop that catches anything an event misses or that errors out.
 */

/** Re-run the formation FSM for one area now (interest there just changed). */
export async function sparkArea(activityTypeId: string, areaId: string): Promise<void> {
  try {
    await evaluate(txnDb as unknown as EngineDb, activityTypeId, areaId, new Date());
  } catch (e) {
    console.error("[mime] sparkArea failed (cron will retry)", {
      areaId,
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
