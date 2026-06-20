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
import { and, eq, inArray, like, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users, areas, interestSignals, games, gameRoster, gameAttendance, activityTypes, areaCaptains,
  formationAttempts, suggestions, formationOptions,
} from "@/lib/db/schema";
import { cellsForPoint } from "@/lib/geo/h3";
import { ensureArea } from "@/lib/geo/ensureArea";
import { milesToKm, haversineKm } from "@/lib/geo/distance";
import { occurrenceDatesInRange } from "@/lib/datetime";
import { gameColor } from "@/lib/brand";

// Deliberate population pools — replaces the old population-weighted ZIP scatter
// (which seeded ~220 across the metro and over-filled rosters with "everybody's
// in everywhere"). Each pool's `mi` is its users' travel radius, which controls
// reachability for the standing games:
//   * Morrison Park (Coralville) is ~12km from the Coralville zone; users there
//     with 8–12mi radii are eligible. CR zone is ~28km away — only the wide-
//     radius cross-city cohort can reach it.
//   * Noelridge (Cedar Rapids) is the mirror — only CR zone reaches it.
//   * Marion/Hiawatha keep small radii so they live near their forming-site
//     demos (seeded separately) and don't roster onto the standing games.
//   * SE Iowa City pocket sits ~16km from Morrison and ~40km from Noelridge with
//     a 5mi radius — concentrated "unspoken for" interest, the user's request.
type Pool = { zip: string; city: string; lat: number; lng: number; n: number; mi: number; tag: "coralville" | "cr" | "free" };
const POOLS: Pool[] = [
  // Coralville/IC zone — feeds Morrison Park (roster cap 60)
  { zip: "52241", city: "Coralville",    lat: 41.690, lng: -91.600, n: 30, mi:  8, tag: "coralville" },
  { zip: "52246", city: "Iowa City",     lat: 41.650, lng: -91.560, n: 18, mi: 10, tag: "coralville" },
  { zip: "52317", city: "North Liberty", lat: 41.750, lng: -91.600, n: 12, mi: 12, tag: "coralville" },
  // Cedar Rapids zone — feeds Noelridge (roster cap 35)
  { zip: "52404", city: "Cedar Rapids",  lat: 41.930, lng: -91.700, n: 23, mi: 10, tag: "cr" },
  { zip: "52402", city: "Cedar Rapids",  lat: 42.020, lng: -91.650, n: 12, mi: 10, tag: "cr" },
  // Forming-site pockets — small radius, only for the formation-history demo
  { zip: "52302", city: "Marion",        lat: 42.030, lng: -91.590, n: 10, mi:  4, tag: "free" },
  { zip: "52233", city: "Hiawatha",      lat: 42.045, lng: -91.685, n:  8, mi:  4, tag: "free" },
  // Concentrated "unspoken for" pocket — too far for either standing game
  { zip: "52240", city: "Iowa City",     lat: 41.595, lng: -91.430, n: 40, mi:  5, tag: "free" },
];
const TOTAL = POOLS.reduce((s, p) => s + p.n, 0);
const ZIP_ONLY_FRACTION = 0.18;
// A small "wide-radius" cohort makes a few cross-city commuters visible — without
// it everyone stays in their home pool. 4 from each game zone → ~3 each direction
// after the cap shuffle (smaller-cap game rosters first to balance both ways).
const WIDE_PER_TAG = 4;
const WIDE_MI = 100;
const ROSTER_CAPS: Record<string, number> = { Coralville: 60, "Cedar Rapids": 35 };

const STREETS = [
  "Maple", "Oak", "1st", "Park", "Brown Deer", "Prairie", "Linn", "Dubuque",
  "Riverside", "Mormon Trek", "Rochester", "Blairs Ferry", "Edgewood", "Forevergreen",
];
const SUFFIX = ["St", "Ave", "Rd", "Trail", "Ln", "Dr"];

// Display names — a mix of plausible "Steve Martinez" handles and playful
// nicknames so the UI doesn't read like "Coralville 1, Coralville 2…". Picked
// deterministically from userIx so reseeds produce stable names for stable
// user indices (the captain pick + forming-site cohorts stay the same person
// across reruns instead of getting renamed each pass).
const FIRST_NAMES = [
  "Aaron", "Andre", "Becca", "Carlos", "Devon", "Diana", "Diego", "Elena",
  "Emma", "Felix", "Greg", "Heather", "Imani", "Jamal", "Jared", "Jaylen",
  "Kim", "Lisa", "Marcus", "Maria", "Megan", "Miles", "Olivia", "Priya",
  "Raj", "Sarah", "Sophie", "Steve", "Terrell", "Tyler", "Vivian", "Yusuf",
];
const LAST_NAMES = [
  "Anderson", "Brown", "Chen", "Davis", "Garcia", "Hernandez", "Hill",
  "Johnson", "Khan", "Kim", "Lee", "Lopez", "Martinez", "Mitchell", "Nguyen",
  "O'Brien", "Park", "Patel", "Pham", "Reyes", "Robinson", "Rodriguez",
  "Sullivan", "Tanaka", "Thompson", "Walker", "Wallace", "Williams", "Wright", "Yang",
];
const NICKNAMES = [
  "Captain Butterfingers", "Big D", "The Rocket", "Punter Pete", "Sticky Mitts",
  "Tank", "Zoom", "Coach", "Doc", "T-Bone", "Speedy", "Wheels", "Cannon Arm",
  "Mudpuddle", "Slick", "Hammer", "Buckshot", "Houdini", "The Wall", "Spider",
  "Bullseye", "Jet", "Cleats", "The Hawk", "Burner", "Beast Mode", "Wildcard",
  "Smokey", "Diesel", "Captain Comeback", "Hailmary", "Iceman", "Lightning",
  "Magic Hands", "Maverick", "Picasso", "Scout", "Tornado", "Vortex", "Yardage King",
];
function pickName(ix: number): string {
  // ~30% nicknames, 70% First Last. Deterministic on ix so reseeds are stable.
  if (ix % 10 < 3) return NICKNAMES[(ix * 17) % NICKNAMES.length];
  return `${FIRST_NAMES[(ix * 13) % FIRST_NAMES.length]} ${LAST_NAMES[(ix * 7) % LAST_NAMES.length]}`;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[(Math.random() * xs.length) | 0];

async function clean() {
  // Order matters: a user can't be deleted while it still has a game_roster row
  // (no cascade) or other dependent rows. Strip activity-scoped state first, then
  // demo users (interest_signals cascades off the user delete via FK).
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (act) {
    await db.delete(games).where(eq(games.activityTypeId, act.id));            // cascades game_roster
    const actAreas = await db.select({ id: areas.id }).from(areas)
      .where(eq(areas.activityTypeId, act.id));
    for (const a of actAreas) {
      await db.delete(formationAttempts).where(eq(formationAttempts.areaId, a.id)); // cascades suggestions/options/promises
      await db.delete(areaCaptains).where(eq(areaCaptains.areaId, a.id));
    }
    await db.update(areas).set({ status: "DORMANT" }).where(eq(areas.activityTypeId, act.id));
  }
  const demo = await db.select({ id: users.id }).from(users).where(like(users.email, "demo-%@demo.test"));
  for (const u of demo) await db.delete(interestSignals).where(eq(interestSignals.userId, u.id));
  await db.delete(users).where(like(users.email, "demo-%@demo.test"));
  console.log(`removed ${demo.length} demo users + reset games/areas`);
}

/** Reset prior demo games + statuses (clean() doesn't touch games), then seed
 *  two DISTINCT standing games (own park/schedule/turnout/history) + a proposed
 *  forming site. game_roster / notifications cascade off games. */
async function seedGamesAndSites(activityId: string) {
  await db.delete(games).where(eq(games.activityTypeId, activityId));
  // formation_attempts (and cascading suggestions/options/promises) reset each run
  const allAreas = await db.select({ id: areas.id }).from(areas)
    .where(eq(areas.activityTypeId, activityId));
  for (const a of allAreas) await db.delete(formationAttempts).where(eq(formationAttempts.areaId, a.id));
  await db.update(areas).set({ status: "DORMANT" }).where(eq(areas.activityTypeId, activityId));

  const WEEK = 7 * 86_400_000;
  // Standing games carry their recurrence (recurDow + recurTime) explicitly so
  // the UI can render "Tuesdays at 6:30 PM" instead of falling back to a single
  // scheduled-start string. scheduledStart for the first/next instance is
  // computed from the recurDow (next occurrence ≥ today).
  const STANDING = [
    { city: "Coralville",   place: "S.T. Morrison Park", recurDow: 1, recurTime: "18:00", base: 9,  skip: [2, 6] }, // Mon 6:00 pm
    { city: "Cedar Rapids", place: "Noelridge Park",     recurDow: 3, recurTime: "18:30", base: 13, skip: [4] },    // Wed 6:30 pm
  ];
  const nextOccurrence = (dow: number, time: string): Date => {
    const today = new Date();
    const delta = (dow - today.getDay() + 7) % 7;
    const [h, m] = time.split(":").map(Number);
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta, h, m, 0, 0);
  };
  for (const gc of STANDING) {
    const [a] = await db.select({ id: areas.id }).from(areas)
      .where(and(eq(areas.activityTypeId, activityId), eq(areas.displayCity, gc.city))).limit(1);
    if (!a) { console.log(`  (no ${gc.city} area for a game — skipped)`); continue; }
    await db.update(areas).set({ status: "SCHEDULED" }).where(eq(areas.id, a.id));
    const nextStart = nextOccurrence(gc.recurDow, gc.recurTime);
    // One color per area — shared by this week's instance and every history row,
    // so a recurring game keeps the same color across its weekly instances.
    const color = gameColor(a.id);
    await db.insert(games).values({
      activityTypeId: activityId, areaId: a.id, placeText: gc.place,
      scheduledStart: nextStart,
      status: "STANDING", confirmedCount: gc.base, isStanding: true,
      color,
      recurDow: gc.recurDow, recurTime: `${gc.recurTime}:00`,
    });
    const skip = new Set(gc.skip);
    const hist = [];
    for (let i = 0; i < 10; i++) {
      if (skip.has(i)) continue;
      hist.push({
        activityTypeId: activityId, areaId: a.id, placeText: gc.place,
        scheduledStart: new Date(Date.now() - (i + 0.5) * WEEK),
        status: "COMPLETED" as const, confirmedCount: Math.max(2, gc.base - 4 + ((Math.random() * 8) | 0)),
        color,
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

/** Insert the live SUGGESTING attempt (window still open) for a forming site,
 *  along with its current suggestions. Extracted from seedFormingHistory so the
 *  outer pass stays under the sprawl limit and the live-flow seed is self-
 *  contained. */
async function seedLiveAttempt(
  activityId: string,
  areaId: string,
  attemptNum: number,
  cityUsers: { id: string }[],
  fc: {
    lat: number; lng: number;
    live: { cohort: number; closesInDays: number; suggs: { text: string; dow: number; time: string }[] };
  },
  now: number,
) {
  const DAY = 86_400_000;
  const openedAt = new Date(now - 4 * DAY);
  const closesAt = new Date(now + fc.live.closesInDays * DAY);
  const liveCohort = cityUsers.slice(0, fc.live.cohort).map((u) => u.id);

  const [live] = await db.insert(formationAttempts).values({
    activityTypeId: activityId, areaId, attemptNumber: attemptNum, status: "SUGGESTING",
    catchmentCells: [], cohortUserIds: liveCohort,
    suggestionOpenedAt: openedAt, suggestionClosesAt: closesAt,
  }).returning({ id: formationAttempts.id });

  for (let si = 0; si < fc.live.suggs.length; si++) {
    const s = fc.live.suggs[si];
    const suggestor = cityUsers[si % cityUsers.length];
    const proposed = new Date(now);
    const skip = ((s.dow - new Date(now).getDay() + 7) % 7) || 7;
    proposed.setDate(proposed.getDate() + skip + 7);
    const [h, m] = s.time.split(":").map(Number);
    proposed.setHours(h, m, 0, 0);
    await db.insert(suggestions).values({
      attemptId: live.id, userId: suggestor.id,
      placeText: s.text, placeLat: fc.lat, placeLng: fc.lng,
      proposedStart: proposed, recurDow: s.dow, recurTime: `${s.time}:00`,
    });
  }
}

/** Two forming sites with escalating attempt history: previous votes that fell
 *  short, growing cohorts each round, and a live suggestion window right now. */
async function seedFormingHistory(activityId: string) {
  const DAY = 86_400_000;
  const now = Date.now();

  const SITES = [
    {
      city: "Marion",
      place: "Colony Road Sports Complex",
      lat: 42.023, lng: -91.597,
      past: [
        { daysAgo: 91, cohort: 5, reason: "not enough players committed",
          opts: [{ text: "Tuesday evenings, Colony Road Sports Complex", dow: 2, votes: 2 }] },
        { daysAgo: 42, cohort: 9, reason: "not enough players committed",
          opts: [
            { text: "Tuesday evenings, Colony Road Sports Complex", dow: 2, votes: 3 },
            { text: "Saturday mornings, Colony Road Sports Complex", dow: 6, votes: 2 },
          ] },
      ],
      live: { cohort: 16, closesInDays: 5,
        suggs: [
          { text: "Colony Road Sports Complex", dow: 6, time: "10:00" },
          { text: "Lowe Park, Marion",           dow: 2, time: "18:30" },
          { text: "Colony Road Sports Complex", dow: 6, time: "09:00" },
        ] },
    },
    {
      city: "Hiawatha",
      place: "Prairie Park",
      lat: 42.046, lng: -91.685,
      past: [
        { daysAgo: 63, cohort: 4, reason: "not enough players committed",
          opts: [{ text: "Saturdays, Prairie Park Hiawatha", dow: 6, votes: 2 }] },
        { daysAgo: 28, cohort: 7, reason: "not enough players committed",
          opts: [
            { text: "Saturdays, Prairie Park Hiawatha",   dow: 6, votes: 3 },
            { text: "Sundays, Boyson Road Park Hiawatha", dow: 0, votes: 1 },
          ] },
      ],
      live: { cohort: 13, closesInDays: 3,
        suggs: [
          { text: "Prairie Park, Hiawatha",      dow: 6, time: "11:00" },
          { text: "Boyson Road Park, Hiawatha",  dow: 0, time: "14:00" },
        ] },
    },
  ];

  for (const fc of SITES) {
    const [area] = await db.select({ id: areas.id }).from(areas)
      .where(and(eq(areas.activityTypeId, activityId), eq(areas.displayCity, fc.city))).limit(1);
    if (!area) { console.log(`  (no ${fc.city} area — skipped forming history)`); continue; }

    const cityUsers = await db.select({ id: users.id }).from(users)
      .where(and(like(users.email, "demo-%@demo.test"), eq(users.city, fc.city)));
    if (cityUsers.length < 3) { console.log(`  (too few users in ${fc.city} — skipped)`); continue; }

    let attemptNum = 1;
    for (const p of fc.past) {
      const createdAt = new Date(now - p.daysAgo * DAY);
      const closedAt  = new Date(createdAt.getTime() + 2 * DAY);
      const cohort    = cityUsers.slice(0, p.cohort).map((u) => u.id);

      const [att] = await db.insert(formationAttempts).values({
        activityTypeId: activityId, areaId: area.id,
        attemptNumber: attemptNum++, status: "FAILED", failureReason: p.reason,
        catchmentCells: [], cohortUserIds: cohort,
        suggestionOpenedAt: createdAt, suggestionClosesAt: closedAt, createdAt,
      }).returning({ id: formationAttempts.id });

      // Seed the options that were voted on but couldn't hit quorum.
      const optBase = new Date(createdAt.getTime() + 10 * DAY);
      for (const opt of p.opts) {
        const proposed = new Date(optBase);
        const skip = ((opt.dow - optBase.getDay() + 7) % 7) || 7;
        proposed.setDate(proposed.getDate() + skip);
        proposed.setHours(19, 0, 0, 0);
        await db.insert(formationOptions).values({
          attemptId: att.id, placeText: opt.text,
          placeLat: fc.lat, placeLng: fc.lng,
          proposedStart: proposed, firstSuggestedAt: createdAt,
          promiseCount: opt.votes,
        });
      }
    }

    // Live SUGGESTING attempt — window still open.
    await seedLiveAttempt(activityId, area.id, attemptNum, cityUsers, fc, now);

    await db.update(areas).set({ status: "IN_FORMATION" }).where(eq(areas.id, area.id));
    console.log(`  forming site in ${fc.city}: ${fc.past.length} past attempts + live (cohort ${fc.live.cohort})`);
  }
}

/** Roster ~half of each standing game's *eligible* players — those within their
 *  own travel radius of it — spread across that whole area. Rostered = claimed by
 *  the game; the rest stay free (could reach it, passed on it). A user belongs to
 *  at most one game. This is what makes members and non-members interleave on the
 *  map instead of all interest hugging the park. */
async function seedRosters(activityId: string) {
  const standing = await db
    .select({ id: games.id, lat: areas.centerLat, lng: areas.centerLng, city: areas.displayCity })
    .from(games).innerJoin(areas, eq(games.areaId, areas.id))
    .where(and(eq(games.activityTypeId, activityId), eq(games.status, "STANDING")));

  const interested = await db
    .select({ userId: interestSignals.userId, zip: users.zip,
              lat: users.homeLat, lng: users.homeLng, km: users.maxTravelKm })
    .from(interestSignals).innerJoin(users, eq(users.id, interestSignals.userId))
    .where(and(
      eq(interestSignals.activityTypeId, activityId),
      eq(interestSignals.active, true),
      like(users.email, "demo-%@demo.test"),
    ));

  // ZIPs that count as each game's "home zone" (used for cross-city assignment).
  const ZONE_ZIPS: Record<string, string[]> = {
    Coralville:    ["52241", "52246", "52317"],
    "Cedar Rapids": ["52404", "52402"],
  };
  const wideKm = milesToKm(WIDE_MI);
  const taken = new Set<string>();

  // PHASE 1 — pre-roster the cross-city cohort. For each standing game, pick
  // WIDE_PER_TAG users from the OPPOSITE city's home zone, bump their travel
  // radius to WIDE_MI, and roster them onto this game. This gives both rosters
  // a few visible commuters instead of letting shuffle absorb them locally.
  const crossCityByGame = new Map<string, string[]>();
  for (const g of standing) {
    const otherCity = Object.keys(ROSTER_CAPS).find((c) => c !== g.city);
    if (!otherCity) continue;
    const otherZips = new Set(ZONE_ZIPS[otherCity] ?? []);
    const candidates = interested.filter((u) => !taken.has(u.userId) && u.zip != null && otherZips.has(u.zip));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0; [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const picked = candidates.slice(0, WIDE_PER_TAG);
    if (picked.length) {
      const ids = picked.map((p) => p.userId);
      await db.update(users).set({ maxTravelKm: wideKm }).where(inArray(users.id, ids));
      await db.insert(gameRoster).values(ids.map((id) => ({ gameId: g.id, userId: id })))
        .onConflictDoNothing();
      ids.forEach((id) => taken.add(id));
      // reflect the new radius for the eligibility check below
      for (const p of picked) p.km = wideKm;
      crossCityByGame.set(g.id, ids);
    }
  }

  // PHASE 2 — fill each roster up to its cap from home-zone eligible users.
  // Smaller-cap-first so any remaining wide users still flow to the smaller game.
  standing.sort((a, b) => (ROSTER_CAPS[a.city ?? ""] ?? 0) - (ROSTER_CAPS[b.city ?? ""] ?? 0));
  for (const g of standing) {
    const cap = ROSTER_CAPS[g.city ?? ""] ?? 30;
    const eligible = interested.filter((u) =>
      !taken.has(u.userId) && u.lat != null && u.lng != null &&
      haversineKm(u.lat, u.lng, g.lat, g.lng) <= (u.km ?? 24));
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0; [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const crossCity = crossCityByGame.get(g.id) ?? [];
    const fill = eligible.slice(0, Math.max(0, cap - crossCity.length));
    if (fill.length) {
      await db.insert(gameRoster).values(fill.map((m) => ({ gameId: g.id, userId: m.userId })))
        .onConflictDoNothing();
      fill.forEach((m) => taken.add(m.userId));
    }
    const total = fill.length + crossCity.length;
    await db.update(games).set({ confirmedCount: total }).where(eq(games.id, g.id));
    console.log(`  rostered ${total} into ${g.city} (cap ${cap}; ${crossCity.length} cross-city + ${fill.length} home-zone)`);
  }

  // PHASE 3 — backfill ~8 weeks of past attendance so the Past panel shows real
  // history on a fresh seed (otherwise it stays empty until the tick freeze runs).
  const histNow = new Date();
  const standingRows = await db.select({ id: games.id, recurDow: games.recurDow, scheduledStart: games.scheduledStart })
    .from(games).where(and(eq(games.isStanding, true), inArray(games.status, ["STAGED", "STANDING"])));
  for (const g of standingRows) {
    const roster = (await db.select({ u: gameRoster.userId }).from(gameRoster).where(eq(gameRoster.gameId, g.id))).map((r) => r.u);
    if (!roster.length) continue;
    const dates = occurrenceDatesInRange(
      { isStanding: true, recurDow: g.recurDow, scheduledStart: String(g.scheduledStart) },
      new Date(histNow.getTime() - 56 * 86_400_000), new Date(histNow.getTime() - 86_400_000),
    );
    for (const date of dates) {
      const noGame = Math.random() < 0.15; // some weeks just didn't draw a crowd
      const frac = noGame ? Math.random() * 0.08 : 0.5 + Math.random() * 0.45;
      const shuffled = [...roster];
      for (let k = shuffled.length - 1; k > 0; k--) {
        const j = (Math.random() * (k + 1)) | 0; [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
      }
      const who = shuffled.slice(0, Math.round(roster.length * frac));
      if (!who.length) continue;
      await db.insert(gameAttendance)
        .values(who.map((uid) => ({ gameId: g.id, userId: uid, occurrenceDate: date, status: "in" as const })))
        .onConflictDoNothing();
    }
  }
}

async function main() {
  if (process.argv.includes("--clean")) { await clean(); return; }

  const [activity] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!activity) throw new Error("flag-football activity not seeded");

  let real = 0, zipOnly = 0, userIx = 0;
  // user ids grouped by pool tag — used after the scatter to assign the wide-radius
  // cross-city cohort (without that, nobody reaches the other city's game).
  const idsByTag: Record<Pool["tag"], string[]> = { coralville: [], cr: [], free: [] };

  for (const pool of POOLS) {
    for (let j = 0; j < pool.n; j++) {
      const isZipOnly = Math.random() < ZIP_ONLY_FRACTION;
      let lat = pool.lat, lng = pool.lng;
      if (!isZipOnly) {
        const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random());
        lat += Math.cos(a) * rr * 0.025;
        lng += Math.sin(a) * rr * 0.032;
      }
      const cells = cellsForPoint(lat, lng);
      const addr = isZipOnly ? {} : {
        addressLine1: `${(rand(100, 4999) | 0)} ${pick(STREETS)} ${pick(SUFFIX)}`,
        state: "IA",
      };

      const [user] = await db.insert(users)
        .values({
          email: `demo-${userIx}@demo.test`,
          displayName: pickName(userIx),
          city: pool.city, zip: pool.zip, ...addr,
          homeLat: lat, homeLng: lng,
          maxTravelKm: milesToKm(pool.mi),
          h3R5: cells.r5, h3R6: cells.r6, h3R7: cells.r7, h3R8: cells.r8, h3R9: cells.r9,
        })
        // Refresh ALL location-shaped fields on rerun, not just city/zip/radius,
        // so the user's home + h3 cells stay consistent with the new interest
        // signals we insert below (otherwise stale H3 leaves us with phantom
        // signals scattered across past random positions).
        .onConflictDoUpdate({ target: users.email,
          set: {
            displayName: pickName(userIx),
            city: pool.city, zip: pool.zip, ...addr,
            homeLat: lat, homeLng: lng,
            maxTravelKm: milesToKm(pool.mi),
            h3R5: cells.r5, h3R6: cells.r6, h3R7: cells.r7, h3R8: cells.r8, h3R9: cells.r9,
          },
        })
        .returning({ id: users.id });

      const areaId = await ensureArea(activity.id, cells.r7,
        { city: pool.city, zip: pool.zip, centerLat: cells.snapLat, centerLng: cells.snapLng });
      // Drop stale interest from past reruns (the user's jittered position may
      // have landed in a different H3 cell), then insert the fresh signal. This
      // keeps reruns without --clean idempotent: one active signal per demo user.
      await db.delete(interestSignals)
        .where(and(eq(interestSignals.userId, user.id), eq(interestSignals.activityTypeId, activity.id)));
      await db.insert(interestSignals)
        .values({ activityTypeId: activity.id, userId: user.id, areaId, h3Base: cells.r7, active: true })
        .onConflictDoNothing();

      idsByTag[pool.tag].push(user.id);
      if (isZipOnly) zipOnly++; else real++;
      userIx++;
    }
  }

  // The cross-city cohort is assigned inside seedRosters (deterministically: a few
  // users in each pool get a wide travel radius AND get rostered onto the OTHER
  // city's game directly). Doing it there ensures cross-city flows both ways
  // instead of being absorbed by the home-city game's eligibility.
  const wideIds: string[] = [];

  await seedGamesAndSites(activity.id);
  await seedFormingHistory(activity.id);
  await seedRosters(activity.id);

  console.log(`done: ${TOTAL} demo users (${real} real address, ${zipOnly} ZIP-only, ${wideIds.length} wide-radius)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
