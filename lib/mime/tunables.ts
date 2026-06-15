/**
 * Per-activity formation tunables. Defaults mirror the activity_types columns;
 * an area may override a few. The engine reads tunables only through here, never
 * hardcoded — so a future activity is a values swap.
 */
export type Tunables = {
  nSpark: number;        // interested in catchment to open the first window
  nWarm: number;         // "almost there" UI threshold
  pMin: number;          // soft-promises on the winner to confirm a game
  sMin: number;          // min suggestions to advance past the suggestion window
  optionsCap: number;    // max options in the availability message
  suggestWindowH: number;
  availWindowH: number;
  restallInterest: number; // net-new interested to re-trigger a stalled area
  restallDays: number;     // base cooldown before a time re-trigger
  maxTimeRetries: number;  // time-only retries before an area goes fully dormant
  perUserWeeklyCap: number;
  ignoreDecayWindows: number;
};

export const DEFAULT_TUNABLES: Tunables = {
  nSpark: 8,
  nWarm: 5,
  pMin: 6,
  sMin: 1,
  optionsCap: 6,
  suggestWindowH: 48,
  availWindowH: 48,
  restallInterest: 3,
  restallDays: 14,
  maxTimeRetries: 2,
  perUserWeeklyCap: 2,
  ignoreDecayWindows: 3,
};

/** Activity defaults + optional per-area overrides → effective tunables. */
export function resolveTunables(
  activity: Partial<Tunables>,
  overrides: Partial<Tunables> = {}
): Tunables {
  return { ...DEFAULT_TUNABLES, ...activity, ...overrides };
}
