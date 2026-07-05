import { test } from "node:test";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { World } from "../sim/harness/world";
import {
  activityTypes, areas, games, formationAttempts, attemptInterest, interestSignals, users, areaOptouts,
} from "@/lib/db/schema";
import { detectAreaScenario } from "@/lib/mime/areaScenario";
import type { EngineDb } from "@/lib/mime/engine";

const LAT = 41.7, LNG = -91.6;
const h3Cell = () => BigInt("0x" + latLngToCell(LAT, LNG, 7));

async function seedActivityAndArea(db: EngineDb) {
  const [act] = await db.insert(activityTypes)
    .values({ slug: `ff-${Math.random()}`, displayName: "Flag football" })
    .returning({ id: activityTypes.id });
  const [area] = await db.insert(areas)
    .values({ activityTypeId: act.id, h3Cell: h3Cell(), centerLat: LAT, centerLng: LNG })
    .returning({ id: areas.id });
  return { activityTypeId: act.id, areaId: area.id };
}

/** A user with active interest right at the area's centroid — always inside
 *  anyone's default travel radius. */
async function seedInterestedUser(db: EngineDb, activityTypeId: string, areaId: string, tag: string) {
  const [u] = await db.insert(users)
    .values({ email: `${tag}@example.com`, displayName: tag, zip: "52241", homeLat: LAT, homeLng: LNG })
    .returning({ id: users.id });
  await db.insert(interestSignals)
    .values({ activityTypeId, userId: u.id, areaId, h3Base: h3Cell(), active: true });
  return u.id;
}

test("alone: only the viewer has interest, no game, no proposal", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "alone");
  // The FAQ tells a first user "once N say yes, it's on" — N must be the
  // area's live threshold, carried on every pre-game state.
  if (s.kind === "alone") assert.equal(s.pMin, 6);
});

test("ambient-interest: others nearby, no game, no open proposal", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");
  await seedInterestedUser(db, activityTypeId, areaId, "n1");
  await seedInterestedUser(db, activityTypeId, areaId, "n2");

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "ambient-interest");
  if (s.kind === "ambient-interest") {
    assert.equal(s.othersCount, 2);
    assert.equal(s.totalCount, 3);
    assert.equal(s.viewerIncluded, true);
    assert.equal(s.pMin, 6);
  }
});

test("ambient-interest: viewerIncluded is false when the viewer is opted out of their own area", async () => {
  // catchmentUsers excludes an area_optouts row — so the viewer themselves can
  // be absent from totalCount even though they're the one looking at the HUD.
  // Share copy must not then claim "of us" / "including me".
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");
  await seedInterestedUser(db, activityTypeId, areaId, "n1");
  await db.insert(areaOptouts).values({ areaId, userId: viewer });

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "ambient-interest");
  if (s.kind === "ambient-interest") {
    assert.equal(s.totalCount, 1); // just n1 — viewer excluded
    assert.equal(s.othersCount, 1);
    assert.equal(s.viewerIncluded, false);
  }
});

test("open-proposal: a live proposal outranks ambient interest", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");
  const n1 = await seedInterestedUser(db, activityTypeId, areaId, "n1");
  await seedInterestedUser(db, activityTypeId, areaId, "n2"); // ambient, doesn't respond

  const [att] = await db.insert(formationAttempts).values({
    activityTypeId, areaId, attemptNumber: 1, status: "OPEN",
    proposerId: viewer, placeText: "The Park", proposedStart: new Date(Date.now() + 5 * 86_400_000),
    interestClosesAt: new Date(Date.now() + 24 * 3_600_000),
  }).returning({ id: formationAttempts.id });
  await db.insert(attemptInterest).values([
    { attemptId: att.id, userId: viewer, interested: true },
    { attemptId: att.id, userId: n1, interested: true },
  ]);

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "open-proposal");
  if (s.kind === "open-proposal") {
    assert.equal(s.interestedCount, 2);
    assert.equal(s.pMin, 6); // DEFAULT_TUNABLES.pMin, no override seeded
    assert.equal(s.placeText, "The Park");
  }
});

test("games: a live standing game outranks everything else", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");

  // Even with an OPEN proposal also present, an active game must win.
  await db.insert(formationAttempts).values({
    activityTypeId, areaId, attemptNumber: 1, status: "OPEN",
    proposerId: viewer, placeText: "Old Proposal", proposedStart: new Date(Date.now() + 5 * 86_400_000),
    interestClosesAt: new Date(Date.now() + 24 * 3_600_000),
  });
  await db.insert(games).values({
    activityTypeId, areaId, placeText: "Republic Square — east lot", placeLat: LAT, placeLng: LNG,
    scheduledStart: new Date(Date.now() + 5 * 86_400_000), status: "active", isStanding: true,
    recurDow: 6, recurTime: "10:00:00",
  });

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "games");
  if (s.kind === "games") {
    assert.equal(s.count, 1);
    assert.equal(s.placeText, "Republic Square");
  }
});

test("games: multiple active games report a count with no single place name", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");

  for (const place of ["Field A", "Field B"]) {
    await db.insert(games).values({
      activityTypeId, areaId, placeText: place, placeLat: LAT, placeLng: LNG,
      scheduledStart: new Date(Date.now() + 5 * 86_400_000), status: "active", isStanding: true,
      recurDow: 6, recurTime: "10:00:00",
    });
  }

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "games");
  if (s.kind === "games") {
    assert.equal(s.count, 2);
    assert.equal(s.placeText, null);
  }
});

test("a one-off (non-standing) game doesn't claim the 'games' scenario", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");
  await seedInterestedUser(db, activityTypeId, areaId, "n1"); // so it falls to ambient-interest, not alone

  await db.insert(games).values({
    activityTypeId, areaId, placeText: "One-off Pickup", placeLat: LAT, placeLng: LNG,
    scheduledStart: new Date(Date.now() + 5 * 86_400_000), status: "active", isStanding: false,
  });

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "ambient-interest"); // NOT "games" — a one-off isn't "runs weekly here"
});

test("a past-deadline but still-OPEN attempt still shows as open-proposal", async () => {
  // Matches the map's own badge, which is driven by status alone — an attempt
  // whose deadline just passed but hasn't been resolved yet (the gap before the
  // next cron tick / event-driven resolve) must read the same way here, or the
  // HUD says "nobody's proposed a spot yet" while the map still shows the badge.
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");
  await seedInterestedUser(db, activityTypeId, areaId, "n1");

  await db.insert(formationAttempts).values({
    activityTypeId, areaId, attemptNumber: 1, status: "OPEN",
    proposerId: viewer, placeText: "Overdue", proposedStart: new Date(Date.now() - 5 * 86_400_000),
    interestClosesAt: new Date(Date.now() - 3_600_000), // deadline passed, not yet resolved
  });

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "open-proposal");
});

test("a resolved (FAILED) attempt is ignored — falls through to ambient-interest", async () => {
  const world = await World.create();
  const db = world.db as unknown as EngineDb;
  const { activityTypeId, areaId } = await seedActivityAndArea(db);
  const viewer = await seedInterestedUser(db, activityTypeId, areaId, "viewer");
  await seedInterestedUser(db, activityTypeId, areaId, "n1");

  await db.insert(formationAttempts).values({
    activityTypeId, areaId, attemptNumber: 1, status: "FAILED",
    proposerId: viewer, placeText: "Didn't happen", proposedStart: new Date(Date.now() - 5 * 86_400_000),
    interestClosesAt: new Date(Date.now() - 3_600_000),
  });

  const s = await detectAreaScenario(db, activityTypeId, areaId, viewer);
  assert.equal(s.kind, "ambient-interest");
});
