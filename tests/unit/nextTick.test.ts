import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, isNull } from "drizzle-orm";
import { World } from "../sim/harness/world";
import {
  activityTypes, areas, formationAttempts, games, gameOccurrences, gameRoster,
  notificationsSent, users,
} from "@/lib/db/schema";
import { latLngToCell } from "h3-js";
import { runOccurrences } from "@/lib/mime/occurrences";
import { computeNextTickAt } from "@/lib/mime/scheduleTick";
import type { EngineDb } from "@/lib/mime/engine";

const h3 = (lat: number, lng: number) => BigInt("0x" + latLngToCell(lat, lng, 7));

// Mirrors occurrences.test.ts: standing game kicking off Sat 2026-07-04 10:00Z
// (UTC area), defaults 48h offset / 24h window ⇒ poll opens Thu 07-02 10:00Z,
// closes Fri 07-03 10:00Z. Explicit UTC instants keep it machine-tz independent.
const POLL_OPENS = new Date("2026-07-02T10:00:00Z");
const POLL_CLOSES = new Date("2026-07-03T10:00:00Z");
const KICKOFF = new Date("2026-07-04T10:00:00Z");
const BEFORE_OPEN = new Date("2026-07-01T09:00:00Z");
const DURING_POLL = new Date("2026-07-02T12:00:00Z");
const AFTER_CLOSE = new Date("2026-07-03T12:00:00Z");

async function seedGame(db: EngineDb, lat: number, lng: number, rosterIn: number) {
  const [act] = await db.insert(activityTypes)
    .values({ slug: `ff-${lat}-${lng}`, displayName: "Flag football" })
    .returning({ id: activityTypes.id });
  const [area] = await db.insert(areas).values({
    activityTypeId: act.id, h3Cell: h3(lat, lng), centerLat: lat, centerLng: lng, timezone: "UTC",
  }).returning({ id: areas.id });
  const [game] = await db.insert(games).values({
    activityTypeId: act.id, areaId: area.id, placeText: "The Field",
    placeLat: lat, placeLng: lng, scheduledStart: new Date("2026-06-06T10:00:00Z"),
    status: "active", isStanding: true, recurDow: 6, recurTime: "10:00:00",
  }).returning({ id: games.id });
  for (let i = 0; i < rosterIn; i++) {
    const [u] = await db.insert(users)
      .values({ email: `nt${i}-${lat}-${lng}@x.com`, displayName: `N${i}`, zip: "52241", homeLat: lat, homeLng: lng })
      .returning({ id: users.id });
    await db.insert(gameRoster).values({ gameId: game.id, userId: u.id, defaultStatus: "in" });
  }
  return { actId: act.id, areaId: area.id, gameId: game.id };
}

test("computeNextTickAt: empty world → null (zero games means zero wakes)", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  assert.equal(await computeNextTickAt(db, BEFORE_OPEN), null);
});

test("computeNextTickAt: standing game with no occurrence row → the derived poll-open", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  await seedGame(db, 41.71, -91.61, 6);
  const next = await computeNextTickAt(db, BEFORE_OPEN);
  assert.equal(next?.toISOString(), POLL_OPENS.toISOString());
});

/** Mark queued mail as delivered — what the same tick's flush does right after
 *  the engine step. Without it the pending POLL_ASK backlog is (correctly) the
 *  nearest boundary, which would mask the calendar boundary under test. */
async function deliverQueuedMail(db: EngineDb) {
  await db.update(notificationsSent).set({ emailedAt: new Date() }).where(isNull(notificationsSent.emailedAt));
}

test("computeNextTickAt: once the poll row exists, the stored poll-close drives the wake", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  await seedGame(db, 41.72, -91.62, 6);
  await runOccurrences(db, DURING_POLL); // opens the poll → row exists (polling)
  await deliverQueuedMail(db); // its POLL_ASK backlog is sent; calendar is what's left
  const next = await computeNextTickAt(db, DURING_POLL);
  assert.equal(next?.toISOString(), POLL_CLOSES.toISOString());
});

// The flip side of the two calendar tests: opening a poll queues POLL_ASK mail,
// and until that mail is out the engine's next move is to deliver it, not to
// wait for the poll to close.
test("computeNextTickAt: opening a poll queues mail, and that mail is the next wake", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  await seedGame(db, 41.79, -91.69, 6);
  await runOccurrences(db, DURING_POLL);
  const next = await computeNextTickAt(db, DURING_POLL);
  assert.ok(next && next <= DURING_POLL, `expected an immediate wake to flush mail, got ${next?.toISOString()}`);
});

test("computeNextTickAt: awaiting_game → the kickoff is the next boundary", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  await seedGame(db, 41.73, -91.63, 6); // 6 in ≥ default min → scheduled
  await runOccurrences(db, DURING_POLL);
  await runOccurrences(db, AFTER_CLOSE); // tally → scheduled → awaiting_game
  await deliverQueuedMail(db); // poll + decision mail sent; calendar is what's left
  const next = await computeNextTickAt(db, AFTER_CLOSE);
  assert.equal(next?.toISOString(), KICKOFF.toISOString());
});

test("computeNextTickAt: an OPEN proposal's deadline wins when it's the earliest", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { actId, areaId } = await seedGame(db, 41.74, -91.64, 6);
  const deadline = new Date("2026-07-01T18:00:00Z"); // before Thu's poll-open
  const [u] = await db.insert(users)
    .values({ email: "proposer-nt@x.com", displayName: "P", zip: "52241", homeLat: 41.74, homeLng: -91.64 })
    .returning({ id: users.id });
  await db.insert(formationAttempts).values({
    activityTypeId: actId, areaId, attemptNumber: 999, status: "OPEN",
    proposerId: u.id, placeText: "Elsewhere", proposedStart: new Date("2026-07-08T10:00:00Z"),
    catchmentCells: [], cohortUserIds: [], interestClosesAt: deadline,
  });
  const next = await computeNextTickAt(db, BEFORE_OPEN);
  assert.equal(next?.toISOString(), deadline.toISOString());
});

test("computeNextTickAt: a decided-but-unnotified occurrence is a past-due boundary (crash between tally and notify)", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { gameId } = await seedGame(db, 41.76, -91.66, 6);
  await runOccurrences(db, DURING_POLL); // row exists (polling)
  // Simulate the stranded state: decided, never notified — as if the process
  // died after tallyClosedPolls committed but before notifyDecided ran.
  const decidedAt = new Date("2026-07-03T10:30:00Z");
  await db.update(gameOccurrences)
    .set({ status: "scheduled", inCount: 6, notifiedAt: null, updatedAt: decidedAt })
    .where(eq(gameOccurrences.gameId, gameId));
  const next = await computeNextTickAt(db, AFTER_CLOSE);
  // Past-due (≤ now) ⇒ the enqueuer wakes immediately instead of waiting for
  // the kickoff or next week's poll-open.
  assert.ok(next && next <= AFTER_CLOSE, `expected past-due boundary, got ${next?.toISOString()}`);
  assert.equal(next?.toISOString(), decidedAt.toISOString());
});

// Regression: enqueuing email set no boundary, so the "proposed near you" ask
// waited for an unrelated wake — in practice the daily backstop, up to a day
// late on a 48h interest window. A pending row must be past-due on sight.
test("computeNextTickAt: queued email is a past-due boundary (mail doesn't wait for the daily cron)", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { actId, areaId } = await seedGame(db, 41.77, -91.67, 6);
  const [u] = await db.insert(users)
    .values({ email: "queued-nt@x.com", displayName: "Q", zip: "52241", homeLat: 41.77, homeLng: -91.67 })
    .returning({ id: users.id });
  const [att] = await db.insert(formationAttempts).values({
    activityTypeId: actId, areaId, attemptNumber: 998, status: "OPEN",
    proposerId: u.id, placeText: "Somewhere", proposedStart: new Date("2026-07-09T10:00:00Z"),
    catchmentCells: [], cohortUserIds: [],
    // Every calendar boundary here is in the future (this deadline, and the
    // seeded game's 07-02 poll-open) — the queued mail is what pulls the wake
    // back to now.
    interestClosesAt: new Date("2026-07-06T10:00:00Z"),
  }).returning({ id: formationAttempts.id });
  const enqueuedAt = new Date(BEFORE_OPEN.getTime() - 60_000);
  await db.insert(notificationsSent).values({
    userId: u.id, attemptId: att.id, kind: "GAME_PROPOSED", channel: "email",
    sentAt: enqueuedAt, emailedAt: null,
  });
  const next = await computeNextTickAt(db, BEFORE_OPEN);
  assert.ok(next && next <= BEFORE_OPEN, `expected past-due boundary, got ${next?.toISOString()}`);
  assert.equal(next?.toISOString(), enqueuedAt.toISOString());
});

// A failed send releases the row (emailed_at back to null). Without an age
// bound that row is past-due forever, re-arming the tick every minute for good
// — the always-awake burn this scheduler exists to prevent.
test("computeNextTickAt: an email pending over an hour stops driving wakes (no infinite re-arm)", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { actId, areaId } = await seedGame(db, 41.78, -91.68, 6);
  const [u] = await db.insert(users)
    .values({ email: "stuck-nt@x.com", displayName: "S", zip: "52241", homeLat: 41.78, homeLng: -91.68 })
    .returning({ id: users.id });
  const [att] = await db.insert(formationAttempts).values({
    activityTypeId: actId, areaId, attemptNumber: 997, status: "OPEN",
    proposerId: u.id, placeText: "Stuck", proposedStart: new Date("2026-07-09T10:00:00Z"),
    catchmentCells: [], cohortUserIds: [], interestClosesAt: new Date("2026-07-06T10:00:00Z"),
  }).returning({ id: formationAttempts.id });
  // Two hours before the tick's own clock — outside the one-hour window, so
  // undeliverable rather than urgent. Anchored to BEFORE_OPEN, not Date.now():
  // a wall-clock stamp lands ~2 months AFTER this tick's `now`, which passes the
  // age filter and then loses the min() on distance alone — the assertion below
  // would hold with the bound removed entirely, testing nothing.
  await db.insert(notificationsSent).values({
    userId: u.id, attemptId: att.id, kind: "GAME_PROPOSED", channel: "email",
    sentAt: new Date(BEFORE_OPEN.getTime() - 2 * 3600_000), emailedAt: null,
  });
  const next = await computeNextTickAt(db, BEFORE_OPEN);
  // Falls back to the real calendar boundary, not an immediate wake.
  assert.equal(next?.toISOString(), POLL_OPENS.toISOString());
});

test("computeNextTickAt: paused series generates no wakes", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { gameId } = await seedGame(db, 41.75, -91.65, 6);
  await db.update(games).set({ status: "paused" }).where(eq(games.id, gameId));
  assert.equal(await computeNextTickAt(db, BEFORE_OPEN), null);
});
