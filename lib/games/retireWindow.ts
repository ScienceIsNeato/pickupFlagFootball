// Pure retire-window helpers — no DB import, so they're unit-testable on their
// own (the DB-backed eligibility check lives in ./retireEligibility).

/** A series can be retired only after this many straight weeks with no game
 *  played — so a live game can't be killed off prematurely. Pause is the path
 *  for a temporary break. */
export const RETIRE_DEAD_WEEKS = 4;
export const RETIRE_WINDOW_MS = RETIRE_DEAD_WEEKS * 7 * 86_400_000;

/** Age gate: the series must have existed at least the dead-week window, so a
 *  freshly-formed game can't be retired before it's had a chance to run. */
export function tooNewToRetire(scheduledStart: Date | string, now: Date): boolean {
  return new Date(scheduledStart).getTime() > now.getTime() - RETIRE_WINDOW_MS;
}
