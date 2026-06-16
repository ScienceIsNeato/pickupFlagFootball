import type { Tunables } from "./tunables";
import type { StallDecision } from "./types";

const BACKOFF_DAYS = [14, 30, 60];

/**
 * Compute the cooldown for a stall. Consecutive stalls back off 14 → 30 → 60
 * days; past max_time_retries the area goes fully dormant (nextTriggerAt null →
 * wakes only on new interest). Re-priming always also requires fresh blood:
 * currentInterest + restall_interest. `stallCount` is the new (post-increment)
 * count.
 */
export function backoff(
  stallCount: number,
  currentInterest: number,
  now: Date,
  t: Tunables,
  reason: string
): StallDecision {
  const nextTriggerInterest = currentInterest + t.restallInterest;

  // time retries exhausted → interest-only wake
  if (stallCount > t.maxTimeRetries) {
    return { kind: "STALL", reason, nextTriggerAt: null, nextTriggerInterest };
  }

  const days = BACKOFF_DAYS[Math.min(stallCount - 1, BACKOFF_DAYS.length - 1)] ?? t.restallDays;
  const nextTriggerAt = new Date(now.getTime() + days * 86_400_000);
  return { kind: "STALL", reason, nextTriggerAt, nextTriggerInterest };
}

/** Has a stalled area earned a re-trigger? Either the cooldown elapsed, or
 *  enough net-new interest arrived. */
export function shouldRetrigger(
  now: Date,
  nextTriggerAt: Date | null,
  nextTriggerInterest: number | null,
  currentInterest: number
): boolean {
  const byTime = nextTriggerAt !== null && now.getTime() >= nextTriggerAt.getTime();
  const byInterest = nextTriggerInterest !== null && currentInterest >= nextTriggerInterest;
  return byTime || byInterest;
}
