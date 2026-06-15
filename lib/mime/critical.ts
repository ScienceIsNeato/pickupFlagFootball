import type { Tunables } from "./tunables";

export type Warmth = "cold" | "warm" | "spark";

/** Where an area sits relative to its thresholds. The interest count is the
 *  catchment count (cell + neighbor ring) computed by the shell and passed in. */
export function warmth(interestCount: number, t: Tunables): Warmth {
  if (interestCount >= t.nSpark) return "spark";
  if (interestCount >= t.nWarm) return "warm";
  return "cold";
}

/** Enough interest in the catchment to open the first suggestion window. */
export function shouldSpark(interestCount: number, t: Tunables): boolean {
  return interestCount >= t.nSpark;
}
