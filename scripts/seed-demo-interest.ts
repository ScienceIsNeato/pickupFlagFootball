/**
 * Demo seed: scatter interest across the Iowa City / Cedar Rapids metro,
 * weighted by ZIP population so the density looks real. Idempotent (demo
 * emails). One cluster is pushed to a scheduled game so the green accent shows.
 *
 *   node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts
 *   node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts --clean
 *
 * 80% of users get a precise "real" home — a point scattered around their ZIP
 * (denser near the centre) with a plausible street address — so they spread
 * across the map. 20% are ZIP-only: their home is the ZIP centroid, so they all
 * group there. Travel radius is varied: mostly the 15-mile default, with a tail.
 *
 * NOTE: we don't bundle a real street-address dataset, so the 80% are realistic
 * synthetic points/addresses (population-weighted), not literally real houses.
 * The geographic distribution is what's "real" here.
 */
import { and, eq, like, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, areas, interestSignals, games, gameRoster, activityTypes, areaCaptains } from "@/lib/db/schema";
import { cellsForPoint } from "@/lib/geo/h3";
import { ensureArea } from "@/lib/geo/ensureArea";
import { milesToKm, haversineKm } from "@/lib/geo/distance";

const TOTAL = 220;
const ZIP_ONLY_FRACTION = 0.2;

// Iowa City / Cedar Rapids metro ZIPs: approximate ZCTA population (weight) and
// centroid. Population weights make the scatter demographically realistic.
const METRO = [
  { zip: "52402", city: "Cedar Rapids",  lat: 42.020, lng: -91.650, pop: 33000 },
  { zip: "52404", city: "Cedar Rapids",  lat: 41.930, lng: -91.700, pop: 34000 },
  { zip: "52403", city: "Cedar Rapids",  lat: 41.960, lng: -91.610, pop: 28000 },
  { zip: "52405", city: "Cedar Rapids",  lat: 42.000, lng: -91.720, pop: 30000 },
  { zip: "52411", city: "Cedar Rapids",  lat: 42.050, lng: -91.700, pop: 20000 },
  { zip: "52401", city: "Cedar Rapids",  lat: 41.975, lng: -91.660, pop:  6000 },
  { zip: "52302", city: "Marion",        lat: 42.030, lng: -91.590, pop: 40000 },
  { zip: "52233", city: "Hiawatha",      lat: 42.045, lng: -91.685, pop:  8000 },
  { zip: "52240", city: "Iowa City",     lat: 41.630, lng: -91.500, pop: 30000 },
  { zip: "52245", city: "Iowa City",     lat: 41.670, lng: -91.510, pop: 25000 },
  { zip: "52246", city: "Iowa City",     lat: 41.650, lng: -91.560, pop: 28000 },
  { zip: "52241", city: "Coralville",    lat: 41.690, lng: -91.600, pop: 22000 },
  { zip: "52317", city: "North Liberty", lat: 41.750, lng: -91.600, pop: 20000 },
  { zip: "52340", city: "Tiffin",        lat: 41.710, lng: -91.670, pop:  4500 },
  { zip: "52333", city: "Solon",         lat: 41.810, lng: -91.490, pop:  5500 },
  { zip: "52358", city: "West Branch",   lat: 41.670, lng: -91.350, pop:  4000 },
];

const STREETS = [
  "Maple", "Oak", "1st", "Park", "Brown Deer", "Prairie", "Linn", "Dubuque",
  "Riverside", "Mormon Trek", "Rochester", "Blairs Ferry", "Edgewood", "Forevergreen",
];
const SUFFIX = ["St", "Ave", "Rd", "Trail", "Ln", "Dr"];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[(Math.random() * xs.length) | 0];

function pickZip() {
  const total = METRO.reduce((s, z) => s + z.pop, 0);
  let r = Math.random() * total;
  for (const z of METRO) if ((r -= z.pop) <= 0) return z;
  return METRO[METRO.length - 1];
}

/** Travel radius (miles) for each user: guaranteed 3×100, 1×50, 1×30, and the
 *  rest weighted so 15 (the default) dominates, with some 25s/5s and a few 10s. */
function travelMilesList(n: number): number[] {
  const out: number[] = [100, 100, 100, 50, 30];
  for (let i = out.length; i < n; i++) {
    const r = Math.random();
    out.push(r < 0.62 ? 15 : r < 0.80 ? 25 : r < 0.92 ? 5 : 10);
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

async function clean() {
  const demo = await db.select({ id: users.id }).from(users).where(like(users.email, "demo-%@demo.test"));
  for (const u of demo) await db.delete(interestSignals).where(eq(interestSignals.userId, u.id));
  await db.delete(users).where(like(users.email, "demo-%@demo.test"));
  // also clear demo games + reset area statuses (roster/notifs cascade off games)
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (act) {
    await db.delete(games).where(eq(games.activityTypeId, act.id));
    // area_captains cascade off areas on area delete, but areas aren't deleted —
    // just reset to DORMANT. Clear captains explicitly so re-seeds start fresh.
    const actAreas = await db.select({ id: areas.id }).from(areas)
      .where(eq(areas.activityTypeId, act.id));
    for (const a of actAreas) await db.delete(areaCaptains).where(eq(areaCaptains.areaId, a.id));
    await db.update(areas).set({ status: "DORMANT" }).where(eq(areas.activityTypeId, act.id));
  }
  console.log(`removed ${demo.length} demo users + reset games/areas`);
}

/** Reset prior demo games + statuses (clean() doesn't touch games), then seed
 *  two DISTINCT standing games (own park/schedule/turnout/history) + a proposed
 *  forming site. game_roster / notifications cascade off games. */
async function seedGamesAndSites(activityId: string) {
  await db.delete(games).where(eq(games.activityTypeId, activityId));
  await db.update(areas).set({ status: "DORMANT" }).where(eq(areas.activityTypeId, activityId));

  const WEEK = 7 * 86_400_000;
  const STANDING = [
    { city: "Coralville",   place: "S.T. Morrison Park", standDays: 5, base: 9,  skip: [2, 6] },
    { city: "Cedar Rapids", place: "Noelridge Park",     standDays: 3, base: 13, skip: [4] },
  ];
  for (const gc of STANDING) {
    const [a] = await db.select({ id: areas.id }).from(areas)
      .where(and(eq(areas.activityTypeId, activityId), eq(areas.displayCity, gc.city))).limit(1);
    if (!a) { console.log(`  (no ${gc.city} area for a game — skipped)`); continue; }
    await db.update(areas).set({ status: "SCHEDULED" }).where(eq(areas.id, a.id));
    await db.insert(games).values({
      activityTypeId: activityId, areaId: a.id, placeText: gc.place,
      scheduledStart: new Date(Date.now() + gc.standDays * 86_400_000),
      status: "STANDING", confirmedCount: gc.base, isStanding: true,
    });
    const skip = new Set(gc.skip);
    const hist = [];
    for (let i = 0; i < 10; i++) {
      if (skip.has(i)) continue;
      hist.push({
        activityTypeId: activityId, areaId: a.id, placeText: gc.place,
        scheduledStart: new Date(Date.now() - (i + 0.5) * WEEK),
        status: "COMPLETED" as const, confirmedCount: Math.max(2, gc.base - 4 + ((Math.random() * 8) | 0)),
      });
    }
    await db.insert(games).values(hist);

    // Assign the first demo user in this city as captain.
    const [captain] = await db.select({ id: users.id }).from(users)
      .where(and(like(users.email, "demo-%@demo.test"), eq(users.city, gc.city))).limit(1);
    if (captain) {
      await db.insert(areaCaptains).values({ areaId: a.id, userId: captain.id }).onConflictDoNothing();
    }
    console.log(`  standing game in ${gc.city} (${gc.place}) + ${hist.length} weeks`);
  }

  const [forming] = await db.select({ id: areas.id }).from(areas)
    .where(and(eq(areas.activityTypeId, activityId), eq(areas.displayCity, "North Liberty"), ne(areas.status, "SCHEDULED")))
    .limit(1);
  if (forming) {
    await db.update(areas).set({ status: "IN_FORMATION" }).where(eq(areas.id, forming.id));
    console.log("  marked a North Liberty area as a proposed (forming) site");
  }
}

/** Roster ~half of each standing game's *eligible* players — those within their
 *  own travel radius of it — spread across that whole area. Rostered = claimed by
 *  the game; the rest stay free (could reach it, passed on it). A user belongs to
 *  at most one game. This is what makes members and non-members interleave on the
 *  map instead of all interest hugging the park. */
async function seedRosters(activityId: string) {
  const standing = await db
    .select({ id: games.id, lat: areas.centerLat, lng: areas.centerLng })
    .from(games).innerJoin(areas, eq(games.areaId, areas.id))
    .where(and(eq(games.activityTypeId, activityId), eq(games.status, "STANDING")));

  const interested = await db
    .select({ userId: interestSignals.userId, lat: users.homeLat, lng: users.homeLng, km: users.maxTravelKm })
    .from(interestSignals).innerJoin(users, eq(users.id, interestSignals.userId))
    .where(and(
      eq(interestSignals.activityTypeId, activityId),
      eq(interestSignals.active, true),
      like(users.email, "demo-%@demo.test"),
    ));

  const taken = new Set<string>();
  for (const g of standing) {
    const eligible = interested.filter((u) =>
      !taken.has(u.userId) && u.lat != null && u.lng != null &&
      haversineKm(u.lat, u.lng, g.lat, g.lng) <= (u.km ?? 24));
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0; [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const members = eligible.slice(0, Math.round(eligible.length * 0.5));
    if (members.length) {
      await db.insert(gameRoster).values(members.map((m) => ({ gameId: g.id, userId: m.userId }))).onConflictDoNothing();
      await db.update(games).set({ confirmedCount: members.length }).where(eq(games.id, g.id));
      members.forEach((m) => taken.add(m.userId));
    }
    console.log(`  rostered ${members.length}/${eligible.length} eligible into game ${g.id.slice(0, 8)}`);
  }
}

async function main() {
  if (process.argv.includes("--clean")) { await clean(); return; }

  const [activity] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!activity) throw new Error("flag-football activity not seeded");

  const travel = travelMilesList(TOTAL);
  let real = 0, zipOnly = 0;

  for (let i = 0; i < TOTAL; i++) {
    const z = pickZip();
    const isZipOnly = Math.random() < ZIP_ONLY_FRACTION;

    // Home point: ZIP centroid for zip-only, else a population-ish scatter near
    // the centre (sqrt keeps it denser toward the middle of the ZIP).
    let lat = z.lat, lng = z.lng;
    if (!isZipOnly) {
      const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random());
      lat += Math.cos(a) * rr * 0.03;
      lng += Math.sin(a) * rr * 0.038;
    }
    const cells = cellsForPoint(lat, lng);

    const addr = isZipOnly ? {} : {
      addressLine1: `${(rand(100, 4999) | 0)} ${pick(STREETS)} ${pick(SUFFIX)}`,
      state: "IA",
    };

    const [user] = await db.insert(users)
      .values({
        email: `demo-${i}@demo.test`,
        displayName: `${z.city} ${i}`,
        city: z.city,
        zip: z.zip,
        ...addr,
        homeLat: lat, homeLng: lng,
        maxTravelKm: milesToKm(travel[i]),
        h3R5: cells.r5, h3R6: cells.r6, h3R7: cells.r7, h3R8: cells.r8, h3R9: cells.r9,
      })
      .onConflictDoUpdate({ target: users.email, set: { city: z.city, zip: z.zip, maxTravelKm: milesToKm(travel[i]) } })
      .returning({ id: users.id });

    // ZIP-only folks group at the ZIP-centroid cell; real addresses key to the
    // cell their point lands in. ensureArea centres on the r7 cell centroid.
    const areaId = await ensureArea(activity.id, cells.r7,
      { city: z.city, zip: z.zip, centerLat: cells.snapLat, centerLng: cells.snapLng });

    await db.insert(interestSignals)
      .values({ activityTypeId: activity.id, userId: user.id, areaId, h3Base: cells.r7, active: true })
      .onConflictDoNothing();

    if (isZipOnly) zipOnly++; else real++;
  }

  await seedGamesAndSites(activity.id);
  await seedRosters(activity.id);

  console.log(`done: ${TOTAL} demo users (${real} real address, ${zipOnly} ZIP-only)`);
  const dist = travel.reduce<Record<number, number>>((m, mi) => ((m[mi] = (m[mi] ?? 0) + 1), m), {});
  console.log("  travel miles distribution:", dist);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
