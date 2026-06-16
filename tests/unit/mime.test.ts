import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TUNABLES as T, resolveTunables,
  warmth, shouldSpark, compileOptions, normalizePlace,
  adjudicate, backoff, shouldRetrigger,
  canSend, inQuietHours, shouldDecay,
  onInterest, onSuggestionClose, onAvailabilityClose,
} from "@/lib/mime";
import type { SuggestionInput, OptionTally } from "@/lib/mime";

const now = new Date("2026-06-01T12:00:00Z");
const sug = (id: string, place: string, start: string, created: string): SuggestionInput =>
  ({ id, placeText: place, placeLat: null, placeLng: null,
     proposedStart: new Date(start), createdAt: new Date(created) });
const tally = (place: string, promiseCount: number, firstSuggestedAt: string): OptionTally =>
  ({ placeText: place, placeLat: null, placeLng: null, proposedStart: new Date("2026-06-07T15:00:00Z"),
     firstSuggestedAt: new Date(firstSuggestedAt), promiseCount });

// ── critical ─────────────────────────────────────────────────────────────────
test("warmth: cold below n_warm, warm between, spark at n_spark", () => {
  assert.equal(warmth(4, T), "cold");
  assert.equal(warmth(5, T), "warm");
  assert.equal(warmth(7, T), "warm");
  assert.equal(warmth(8, T), "spark");
  assert.equal(warmth(99, T), "spark");
});

test("shouldSpark is the n_spark boundary", () => {
  assert.equal(shouldSpark(7, T), false);
  assert.equal(shouldSpark(8, T), true);
});

// ── compile ──────────────────────────────────────────────────────────────────
test("normalizePlace folds case, punctuation, whitespace", () => {
  assert.equal(normalizePlace("  City  Park! "), "city park");
  assert.equal(normalizePlace("City-Park"), "citypark");
});

test("compileOptions dedupes same place+time, keeps earliest as first_suggested_at", () => {
  const out = compileOptions([
    sug("a", "City Park", "2026-06-07T15:00:00Z", "2026-06-01T10:00:00Z"),
    sug("b", "city park", "2026-06-07T15:00:00Z", "2026-06-01T11:00:00Z"), // dup of a
    sug("c", "Rec Center", "2026-06-06T14:00:00Z", "2026-06-01T09:00:00Z"),
  ], T);
  assert.equal(out.length, 2);
  // sorted by first_suggested_at: Rec Center (09:00) before City Park (10:00)
  assert.equal(out[0].placeText, "Rec Center");
  assert.equal(out[1].placeText, "City Park");
  assert.deepEqual(out[1].sourceIds, ["a", "b"]);
  assert.equal(out[1].firstSuggestedAt.toISOString(), "2026-06-01T10:00:00.000Z");
});

test("compileOptions caps at options_cap", () => {
  const t = resolveTunables({ optionsCap: 2 });
  const many = Array.from({ length: 5 }, (_, i) =>
    sug(`s${i}`, `Place ${i}`, `2026-06-0${i + 1}T15:00:00Z`, `2026-06-01T1${i}:00:00Z`));
  assert.equal(compileOptions(many, t).length, 2);
});

// ── adjudicate (p_min boundary + tiebreak) ──────────────────────────────────
test("adjudicate: winner is most promises", () => {
  const r = adjudicate([tally("A", 6, "2026-06-01T10:00:00Z"), tally("B", 9, "2026-06-01T11:00:00Z")], T);
  assert.equal(r.kind, "SCHEDULE");
  assert.equal(r.kind === "SCHEDULE" && r.winner.placeText, "B");
});

test("adjudicate: ties break to earliest first_suggested_at", () => {
  const r = adjudicate([
    tally("Late", 6, "2026-06-01T11:00:00Z"),
    tally("Early", 6, "2026-06-01T09:00:00Z"),
  ], T);
  assert.equal(r.kind === "SCHEDULE" && r.winner.placeText, "Early");
});

test("adjudicate: p_min boundary — 5 stalls, 6 schedules", () => {
  assert.equal(adjudicate([tally("A", 5, "2026-06-01T10:00:00Z")], T).kind, "STALL_NO_WINNER");
  assert.equal(adjudicate([tally("A", 6, "2026-06-01T10:00:00Z")], T).kind, "SCHEDULE");
});

test("adjudicate: no options stalls", () => {
  assert.equal(adjudicate([], T).kind, "STALL_NO_WINNER");
});

// ── backoff ──────────────────────────────────────────────────────────────────
test("backoff: 14 → 30 → 60 days, then interest-only", () => {
  const d1 = backoff(1, 8, now, T, "x").nextTriggerAt!;
  const d2 = backoff(2, 8, now, T, "x").nextTriggerAt!;
  const d3 = backoff(3, 8, now, T, "x").nextTriggerAt!;
  const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86_400_000);
  assert.equal(days(d1), 14);
  assert.equal(days(d2), 30);
  assert.equal(days(d3), 60);
  // past max_time_retries (2) + 1 → dormant, no time trigger
  assert.equal(backoff(4, 8, now, T, "x").nextTriggerAt, null);
});

test("backoff: re-prime always demands fresh interest", () => {
  assert.equal(backoff(1, 8, now, T, "x").nextTriggerInterest, 8 + T.restallInterest);
});

test("shouldRetrigger: by elapsed time or by new interest", () => {
  const future = new Date(now.getTime() + 10 * 86_400_000);
  assert.equal(shouldRetrigger(now, future, 11, 8), false);          // neither
  assert.equal(shouldRetrigger(future, future, 11, 8), true);        // time elapsed
  assert.equal(shouldRetrigger(now, future, 11, 11), true);          // interest met
});

// ── gating (weekly cap, quiet hours, decay) ─────────────────────────────────
test("inQuietHours: 21:00–08:00 local", () => {
  assert.equal(inQuietHours(20), false);
  assert.equal(inQuietHours(21), true);
  assert.equal(inQuietHours(2), true);
  assert.equal(inQuietHours(8), false);
});

test("shouldDecay after ignore_decay_windows", () => {
  assert.equal(shouldDecay(2, T), false);
  assert.equal(shouldDecay(3, T), true);
});

test("canSend: weekly cap holds (the 3rd message is suppressed)", () => {
  const base = { localHour: 12, snoozed: false, consecutiveIgnored: 0 };
  assert.equal(canSend({ ...base, sentLast7d: 1 }, T), true);
  assert.equal(canSend({ ...base, sentLast7d: 2 }, T), false); // at cap
});

test("canSend: snoozed, decayed, or quiet hours all block", () => {
  const base = { sentLast7d: 0, localHour: 12, snoozed: false, consecutiveIgnored: 0 };
  assert.equal(canSend(base, T), true);
  assert.equal(canSend({ ...base, snoozed: true }, T), false);
  assert.equal(canSend({ ...base, consecutiveIgnored: 3 }, T), false);
  assert.equal(canSend({ ...base, localHour: 23 }, T), false);
});

// ── fsm transitions ─────────────────────────────────────────────────────────
test("onInterest: sparks a dormant area at n_spark, opens a 48h window", () => {
  const d = onInterest({ status: "DORMANT", interestCount: 8, nextTriggerAt: null,
    nextTriggerInterest: null, now, t: T });
  assert.equal(d.kind, "SPARK");
  const closes = d.kind === "SPARK" ? d.suggestionClosesAt : now;
  assert.equal(Math.round((closes.getTime() - now.getTime()) / 3_600_000), 48);
});

test("onInterest: noop below n_spark, noop while in formation/scheduled", () => {
  assert.equal(onInterest({ status: "DORMANT", interestCount: 7, nextTriggerAt: null,
    nextTriggerInterest: null, now, t: T }).kind, "NOOP");
  assert.equal(onInterest({ status: "IN_FORMATION", interestCount: 99, nextTriggerAt: null,
    nextTriggerInterest: null, now, t: T }).kind, "NOOP");
  assert.equal(onInterest({ status: "SCHEDULED", interestCount: 99, nextTriggerAt: null,
    nextTriggerInterest: null, now, t: T }).kind, "NOOP");
});

test("onInterest: stalled area only re-sparks once cooldown is met", () => {
  const future = new Date(now.getTime() + 5 * 86_400_000);
  assert.equal(onInterest({ status: "STALLED", interestCount: 8, nextTriggerAt: future,
    nextTriggerInterest: 12, now, t: T }).kind, "NOOP");          // cooldown not met
  assert.equal(onInterest({ status: "STALLED", interestCount: 12, nextTriggerAt: future,
    nextTriggerInterest: 12, now, t: T }).kind, "SPARK");         // fresh interest met
});

test("onSuggestionClose: ≥ s_min compiles + opens availability, else stalls", () => {
  const suggestions = [sug("a", "City Park", "2026-06-07T15:00:00Z", "2026-06-01T10:00:00Z")];
  const ok = onSuggestionClose({ suggestions, stallCount: 0, interestCount: 8, now, t: T });
  assert.equal(ok.kind, "COMPILE");
  assert.equal(ok.kind === "COMPILE" && ok.options.length, 1);

  const stall = onSuggestionClose({ suggestions: [], stallCount: 0, interestCount: 8, now, t: T });
  assert.equal(stall.kind, "STALL");
});

test("onAvailabilityClose: schedules a winner over p_min, else stalls", () => {
  const win = onAvailabilityClose({ options: [tally("A", 6, "2026-06-01T10:00:00Z")],
    stallCount: 0, interestCount: 8, now, t: T });
  assert.equal(win.kind, "SCHEDULE");

  const stall = onAvailabilityClose({ options: [tally("A", 5, "2026-06-01T10:00:00Z")],
    stallCount: 0, interestCount: 8, now, t: T });
  assert.equal(stall.kind, "STALL");
});
