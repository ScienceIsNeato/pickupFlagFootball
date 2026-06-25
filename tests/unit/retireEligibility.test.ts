import { test } from "node:test";
import assert from "node:assert/strict";
import { tooNewToRetire, RETIRE_DEAD_WEEKS } from "@/lib/games/retireWindow";

const NOW = new Date("2026-06-25T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const WINDOW_DAYS = RETIRE_DEAD_WEEKS * 7;

test("tooNewToRetire: a game younger than the dead-week window can't be retired", () => {
  assert.equal(tooNewToRetire(daysAgo(1), NOW), true);
  assert.equal(tooNewToRetire(daysAgo(WINDOW_DAYS - 1), NOW), true); // 27 days
});

test("tooNewToRetire: a game at/older than the window passes the age gate", () => {
  assert.equal(tooNewToRetire(daysAgo(WINDOW_DAYS), NOW), false); // exactly 28 days
  assert.equal(tooNewToRetire(daysAgo(60), NOW), false);
});

test("tooNewToRetire: a just-formed game (first game in the future) is too new", () => {
  assert.equal(tooNewToRetire(new Date(NOW.getTime() + 5 * 86_400_000), NOW), true);
});
