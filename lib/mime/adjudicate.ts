import type { Tunables } from "./tunables";
import type { OptionTally, ScheduleDecision, StallDecision } from "./types";

/** The winner is the option with the most soft-promises; ties break to the
 *  earliest first_suggested_at. A winner only schedules a game if it clears
 *  p_min — otherwise the attempt stalls. `now`-free: the shell supplies the
 *  cooldown timestamps for a stall via backoff(). */
export function adjudicate(
  options: OptionTally[],
  t: Tunables
): ScheduleDecision | { kind: "STALL_NO_WINNER"; topCount: number } {
  if (options.length === 0) return { kind: "STALL_NO_WINNER", topCount: 0 };

  const ranked = [...options].sort((a, b) => {
    if (b.promiseCount !== a.promiseCount) return b.promiseCount - a.promiseCount;
    const ta = a.firstSuggestedAt.getTime(), tb = b.firstSuggestedAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.placeText.localeCompare(b.placeText); // fully deterministic on exact ties
  });

  const winner = ranked[0];
  if (winner.promiseCount < t.pMin) {
    return { kind: "STALL_NO_WINNER", topCount: winner.promiseCount };
  }
  return { kind: "SCHEDULE", winner };
}

/** Convenience: does a tally clear the bar? Mirrors the p_min boundary. */
export function clearsThreshold(promiseCount: number, t: Tunables): boolean {
  return promiseCount >= t.pMin;
}

export type AdjudicationResult = ScheduleDecision | StallDecision;
