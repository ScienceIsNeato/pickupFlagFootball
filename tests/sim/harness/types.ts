/** The four perspectives a beat snapshots. Screenshots slot into these same
 *  columns later (Phases 7–8) once map + formation UIs exist. */
export type Perspective = "engine" | "area" | "participant" | "outbox";

export type AssertionResult = { text: string; ok: boolean; detail?: string };

export type BeatResult = {
  n: number;
  time: string;            // clock label, e.g. "T+56h"
  feed: string;            // activity-feed narrative
  cells: Record<Perspective, string>;
  changed: Perspective[];  // which perspectives moved this beat (highlight)
  asserts: AssertionResult[];
};

export type ScenarioStatus = "passed" | "failed" | "pending";

export type ScenarioResult = {
  name: string;
  intent: string;
  status: ScenarioStatus;
  beats: BeatResult[];
  error?: string;          // first failure / thrown error
};

export type SuiteResult = {
  seed: number;
  engineRef: string;
  startedAt: string;
  scenarios: ScenarioResult[];
};
