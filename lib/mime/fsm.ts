import type { Tunables } from "./tunables";
import type {
  AreaStatus, SuggestionInput, OptionTally,
  SparkDecision, CompileDecision, ScheduleDecision, StallDecision, NoopDecision,
} from "./types";
import { shouldSpark } from "./critical";
import { compileOptions } from "./compile";
import { adjudicate } from "./adjudicate";
import { backoff, shouldRetrigger } from "./backoff";

const HOURS = 3_600_000;

/**
 * The FSM as pure transition functions. The shell loads a snapshot, calls the
 * right transition for the event, and persists the returned Decision. The
 * schema enums (area_status / attempt_status) are the on-disk shape; these
 * functions own the rules that move between them.
 */

/** Interest changed (registration / toggle / location move). Sparks a formation
 *  if a dormant or eligibly-stalled area has crossed n_spark. */
export function onInterest(p: {
  status: AreaStatus;
  interestCount: number;
  nextTriggerAt: Date | null;
  nextTriggerInterest: number | null;
  now: Date;
  t: Tunables;
}): SparkDecision | NoopDecision {
  if (p.status === "IN_FORMATION") return { kind: "NOOP", reason: "attempt already live" };
  if (p.status === "SCHEDULED") return { kind: "NOOP", reason: "area already scheduled" };

  if (p.status === "STALLED") {
    const eligible = shouldRetrigger(p.now, p.nextTriggerAt, p.nextTriggerInterest, p.interestCount);
    if (!eligible) return { kind: "NOOP", reason: "stalled, cooldown not met" };
  }

  if (!shouldSpark(p.interestCount, p.t)) {
    return { kind: "NOOP", reason: `below n_spark (${p.interestCount}/${p.t.nSpark})` };
  }
  return { kind: "SPARK", suggestionClosesAt: new Date(p.now.getTime() + p.t.suggestWindowH * HOURS) };
}

/** Suggestion window closed. ≥ s_min suggestions → compile options + open the
 *  availability window; otherwise stall with backoff. */
export function onSuggestionClose(p: {
  suggestions: SuggestionInput[];
  stallCount: number;
  interestCount: number;
  now: Date;
  t: Tunables;
}): CompileDecision | StallDecision {
  if (p.suggestions.length < p.t.sMin) {
    return backoff(p.stallCount + 1, p.interestCount, p.now, p.t, "no suggestions");
  }
  return {
    kind: "COMPILE",
    options: compileOptions(p.suggestions, p.t),
    availabilityClosesAt: new Date(p.now.getTime() + p.t.availWindowH * HOURS),
  };
}

/** Availability window closed. Adjudicate: a winner clearing p_min schedules a
 *  game; otherwise stall with backoff. */
export function onAvailabilityClose(p: {
  options: OptionTally[];
  stallCount: number;
  interestCount: number;
  now: Date;
  t: Tunables;
}): ScheduleDecision | StallDecision {
  const r = adjudicate(p.options, p.t);
  if (r.kind === "SCHEDULE") return r;
  return backoff(
    p.stallCount + 1, p.interestCount, p.now, p.t,
    `no option cleared p_min (top ${r.topCount}/${p.t.pMin})`
  );
}
