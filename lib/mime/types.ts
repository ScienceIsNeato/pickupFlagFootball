/** Plain data the pure core reasons over. The shell builds these from the DB
 *  and persists the returned Decision — the core never touches IO or the clock
 *  except through these values and an injected `now`. */

export type AreaStatus = "DORMANT" | "PRIMED" | "IN_FORMATION" | "SCHEDULED" | "STALLED";
export type AttemptStatus =
  | "SUGGESTING" | "COMPILING" | "AVAILABILITY"
  | "ADJUDICATING" | "CONFIRMED" | "FAILED" | "CANCELLED";

export type SuggestionInput = {
  id: string;
  placeText: string;
  placeLat: number | null;
  placeLng: number | null;
  proposedStart: Date;
  createdAt: Date;
};

export type CompiledOption = {
  placeText: string;
  placeLat: number | null;
  placeLng: number | null;
  proposedStart: Date;
  firstSuggestedAt: Date;   // earliest source suggestion → tiebreak key
  sourceIds: string[];      // suggestions folded into this option
};

export type OptionTally = {
  placeText: string;
  placeLat: number | null;
  placeLng: number | null;
  proposedStart: Date;
  firstSuggestedAt: Date;
  promiseCount: number;
};

// ── decisions the core hands back to the shell ───────────────────────────────
export type SparkDecision = {
  kind: "SPARK";
  suggestionClosesAt: Date;
};
export type CompileDecision = {
  kind: "COMPILE";
  options: CompiledOption[];
  availabilityClosesAt: Date;
};
export type ScheduleDecision = {
  kind: "SCHEDULE";
  winner: OptionTally;
};
export type StallDecision = {
  kind: "STALL";
  reason: string;
  nextTriggerAt: Date | null;     // null → wake only on new interest
  nextTriggerInterest: number;    // interest count that re-primes the area
};
export type NoopDecision = {
  kind: "NOOP";
  reason: string;
};

export type Decision =
  | SparkDecision | CompileDecision | ScheduleDecision | StallDecision | NoopDecision;
