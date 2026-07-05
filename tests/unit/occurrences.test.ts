import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { World } from "../sim/harness/world";
import {
  activityTypes, areas, games, gameRoster, gameOccurrences, notificationsSent, users,
} from "@/lib/db/schema";
import { latLngToCell } from "h3-js";
import { runOccurrences } from "@/lib/mime/occurrences";
import type { EngineDb } from "@/lib/mime/engine";

const h3 = (lat: number, lng: number) => BigInt("0x" + latLngToCell(lat, lng, 7));

// A standing game kicking off Sat 2026-07-04 10:00 (recur_dow 6). With the
// defaults (48h offset, 24h window): poll opens Thu 07-02 10:00, closes Fri
// 07-03 10:00. Local-time Dates throughout (matches the engine's kickoff calc).
const KICK = "2026-07-04T10:00:00";
const BEFORE_OPEN = new Date("2026-07-01T09:00:00");
const POLL_OPEN = new Date("2026-07-02T12:00:00");
const AFTER_CLOSE = new Date("2026-07-03T12:00:00");
const AFTER_KICK = new Date("2026-07-04T11:00:00");

async function seedGame(db: EngineDb, lat: number, lng: number, rosterIn: number, minPlayers?: number) {
  const [act] = await db.insert(activityTypes)
    .values({ slug: `ff-${lat}-${lng}`, displayName: "Flag football" })
    .returning({ id: activityTypes.id });
  const [area] = await db.insert(areas).values({
    activityTypeId: act.id, h3Cell: h3(lat, lng), centerLat: lat, centerLng: lng,
  }).returning({ id: areas.id });
  const [game] = await db.insert(games).values({
    activityTypeId: act.id, areaId: area.id, placeText: "The Field",
    placeLat: lat, placeLng: lng, scheduledStart: new Date("2026-06-06T10:00:00"),
    status: "active", isStanding: true, recurDow: 6, recurTime: "10:00:00",
    minPlayers: minPlayers ?? null, // per-site override; null → area default (6)
  }).returning({ id: games.id });
  for (let i = 0; i < rosterIn; i++) {
    const [u] = await db.insert(users)
      .values({ email: `r${i}-${lat}-${lng}@x.com`, displayName: `R${i}`, zip: "52241", homeLat: lat, homeLng: lng })
      .returning({ id: users.id });
    await db.insert(gameRoster).values({ gameId: game.id, userId: u.id, defaultStatus: "in" });
  }
  return game.id;
}

const occ = (db: EngineDb, gameId: string) =>
  db.select().from(gameOccurrences).where(eq(gameOccurrences.gameId, gameId));
type OccKind = "POLL_ASK" | "WEEK_ON" | "WEEK_OFF";
const notifs = (db: EngineDb, gameId: string, kind: OccKind) =>
  db.select().from(notificationsSent)
    .where(and(eq(notificationsSent.gameId, gameId), eq(notificationsSent.kind, kind)));

test("occurrence cycle: enough RSVPs → scheduled → played", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const gameId = await seedGame(db, 41.70, -91.60, 6); // 6 default-in == min

  await runOccurrences(db, BEFORE_OPEN);
  assert.equal((await occ(db, gameId)).length, 0, "no occurrence before the poll opens");

  await runOccurrences(db, POLL_OPEN);
  let [o] = await occ(db, gameId);
  assert.equal(o.status, "polling", "poll opens → polling");
  assert.equal((await notifs(db, gameId, "POLL_ASK")).length, 6, "rsvp request to each roster member");

  await runOccurrences(db, AFTER_CLOSE);
  [o] = await occ(db, gameId);
  assert.equal(o.inCount, 6, "tallied 6 in");
  assert.equal(o.status, "awaiting_game", "scheduled → notified → awaiting kickoff");
  assert.equal((await notifs(db, gameId, "WEEK_ON")).length, 6, "game-on email to each");

  await runOccurrences(db, AFTER_KICK);
  [o] = await occ(db, gameId);
  assert.equal(o.status, "played", "kickoff passes → played");
});

test("occurrence cycle: too few RSVPs → skipped", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const gameId = await seedGame(db, 40.03, -105.28, 3); // below the default min of 6

  await runOccurrences(db, POLL_OPEN);
  await runOccurrences(db, AFTER_CLOSE);
  const [o] = await occ(db, gameId);
  assert.equal(o.status, "skipped", "below min → skipped");
  assert.equal(o.inCount, 3);
  assert.equal((await notifs(db, gameId, "WEEK_OFF")).length, 3, "week-off email to each");

  await runOccurrences(db, AFTER_KICK);
  assert.equal((await occ(db, gameId))[0].status, "skipped", "skipped is terminal");
});

test("per-site min_players override LOWERS the bar: 5 in schedules when the site min is 5", async () => {
  // 5 in would skip at the area default of 6 — the per-site override (a captain
  // who knows they get walk-ons) drops the bar to 5, so the week runs.
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const gameId = await seedGame(db, 42.10, -92.10, 5, 5);

  await runOccurrences(db, POLL_OPEN);
  await runOccurrences(db, AFTER_CLOSE);
  const [o] = await occ(db, gameId);
  assert.equal(o.inCount, 5);
  assert.equal(o.status, "awaiting_game", "5 in meets the site's min of 5 → scheduled");
  assert.equal((await notifs(db, gameId, "WEEK_ON")).length, 5, "game-on email to each");
});

test("per-site min_players override RAISES the bar: 6 in skips when the site min is 8", async () => {
  // 6 in would schedule at the area default of 6 — a captain who knows they get
  // no-shows raises the bar to 8, so the same 6 aren't enough and the week skips.
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const gameId = await seedGame(db, 43.20, -93.20, 6, 8);

  await runOccurrences(db, POLL_OPEN);
  await runOccurrences(db, AFTER_CLOSE);
  const [o] = await occ(db, gameId);
  assert.equal(o.inCount, 6);
  assert.equal(o.status, "skipped", "6 in is below the site's min of 8 → skipped");
  assert.equal((await notifs(db, gameId, "WEEK_OFF")).length, 6, "week-off email to each");
});
