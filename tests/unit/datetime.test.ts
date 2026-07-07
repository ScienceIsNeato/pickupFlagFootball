import { test } from "node:test";
import assert from "node:assert/strict";
import { upcomingDatesForDow, combineDateTimeToISO, toYMD, gameTimeOptions, zonedWallTimeToUtc, kickoffAtFor } from "@/lib/datetime";

test("zonedWallTimeToUtc: composes a wall clock in a named zone, not the server zone", () => {
  // 10:00 in America/Chicago on 2026-07-04 is CDT (UTC-5) → 15:00 UTC.
  assert.equal(zonedWallTimeToUtc("2026-07-04", "10:00:00", "America/Chicago").toISOString(), "2026-07-04T15:00:00.000Z");
  // UTC zone is the identity — 10:00 UTC.
  assert.equal(zonedWallTimeToUtc("2026-07-04", "10:00", "UTC").toISOString(), "2026-07-04T10:00:00.000Z");
  // A zone east of UTC (Tokyo, UTC+9, no DST).
  assert.equal(zonedWallTimeToUtc("2026-07-04", "18:00", "Asia/Tokyo").toISOString(), "2026-07-04T09:00:00.000Z");
});

test("zonedWallTimeToUtc: DST-aware — same wall clock, different UTC offset across the boundary", () => {
  // America/Chicago: CST (UTC-6) in January, CDT (UTC-5) in July. A 6pm game
  // must land on the right instant in BOTH — the bug this fixes would have used
  // a fixed (server) offset for both.
  assert.equal(zonedWallTimeToUtc("2026-01-10", "18:00", "America/Chicago").toISOString(), "2026-01-11T00:00:00.000Z"); // CST → +6
  assert.equal(zonedWallTimeToUtc("2026-07-10", "18:00", "America/Chicago").toISOString(), "2026-07-10T23:00:00.000Z"); // CDT → +5
});

test("kickoffAtFor: standing game uses its area timezone; one-off uses the fixed instant", () => {
  const kick = kickoffAtFor({ recurTime: "10:00:00", scheduledStart: "2026-06-06T10:00:00Z", timezone: "America/New_York" }, "2026-07-04");
  assert.equal(kick.toISOString(), "2026-07-04T14:00:00.000Z"); // 10:00 EDT (UTC-4)
  const oneOff = kickoffAtFor({ recurTime: null, scheduledStart: "2026-07-04T22:30:00.000Z", timezone: "America/New_York" }, "2026-07-04");
  assert.equal(oneOff.toISOString(), "2026-07-04T22:30:00.000Z"); // the stored instant, unchanged
});

test("upcomingDatesForDow: returns `count` dates, all on the requested weekday", () => {
  const from = new Date(2026, 5, 15); // Mon Jun 15 2026 (local)
  const dates = upcomingDatesForDow(3, 4, from); // Wednesdays
  assert.equal(dates.length, 4);
  for (const d of dates) {
    // parse as local date
    const [y, m, day] = d.split("-").map(Number);
    assert.equal(new Date(y, m - 1, day).getDay(), 3, `${d} should be a Wednesday`);
  }
});

test("upcomingDatesForDow: strictly future — today's weekday rolls to next week", () => {
  const from = new Date(2026, 5, 15); // Monday
  const [first] = upcomingDatesForDow(1, 1, from); // next Monday
  assert.equal(first, "2026-06-22"); // 7 days later, not today
});

test("upcomingDatesForDow: dates are a week apart and increasing", () => {
  const from = new Date(2026, 5, 15);
  const dates = upcomingDatesForDow(5, 3, from); // Fridays
  assert.equal(dates[0], "2026-06-19");
  assert.equal(dates[1], "2026-06-26");
  assert.equal(dates[2], "2026-07-03");
});

test("upcomingDatesForDow: rejects bad input", () => {
  assert.deepEqual(upcomingDatesForDow(7, 3, new Date(2026, 5, 15)), []);
  assert.deepEqual(upcomingDatesForDow(2, 0, new Date(2026, 5, 15)), []);
});

test("toYMD: local calendar day", () => {
  assert.equal(toYMD(new Date(2026, 0, 5)), "2026-01-05");
});

test("combineDateTimeToISO: produces a valid instant, empty on missing parts", () => {
  assert.ok(combineDateTimeToISO("2026-06-22", "18:00").endsWith("Z"));
  assert.equal(combineDateTimeToISO("", "18:00"), "");
  assert.equal(combineDateTimeToISO("2026-06-22", ""), "");
});

test("gameTimeOptions: half-hour grid 6am–10pm with am/pm labels", () => {
  const opts = gameTimeOptions();
  assert.equal(opts[0].value, "06:00");
  assert.equal(opts[0].label, "6:00 am");
  assert.equal(opts.at(-1)!.value, "22:00");
  assert.equal(opts.at(-1)!.label, "10:00 pm");
  assert.ok(opts.some((o) => o.value === "12:00" && o.label === "12:00 pm"));
});
