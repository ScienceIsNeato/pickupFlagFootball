/**
 * Demo seed: scatter interest across an Iowa region so the cluster map has
 * something to collapse/expand. Idempotent (demo emails). One cluster is pushed
 * to a scheduled game so the green accent shows.
 *
 *   node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts
 *   node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts --clean
 */
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, areas, interestSignals, games, activityTypes } from "@/lib/db/schema";
import { cellsForPoint } from "@/lib/geo/h3";
import { ensureArea } from "@/lib/geo/ensureArea";

const CLUSTERS = [
  { name: "Coralville",    lat: 41.6764, lng: -91.5805, n: 60, scheduled: true },
  { name: "Iowa City",     lat: 41.6611, lng: -91.5302, n: 45 },
  { name: "Cedar Rapids",  lat: 41.9779, lng: -91.6656, n: 35 },
  { name: "North Liberty", lat: 41.7491, lng: -91.5974, n: 25 },
  { name: "Tiffin",        lat: 41.7022, lng: -91.6669, n: 12 },
  { name: "West Branch",   lat: 41.6711, lng: -91.3479, n: 8 },
];

async function clean() {
  const demo = await db.select({ id: users.id }).from(users).where(like(users.email, "demo-%@demo.test"));
  for (const u of demo) await db.delete(interestSignals).where(eq(interestSignals.userId, u.id));
  await db.delete(users).where(like(users.email, "demo-%@demo.test"));
  console.log(`removed ${demo.length} demo users`);
}

async function main() {
  if (process.argv.includes("--clean")) { await clean(); return; }

  const [activity] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!activity) throw new Error("flag-football activity not seeded");

  let total = 0;
  for (const c of CLUSTERS) {
    for (let i = 0; i < c.n; i++) {
      const lat = c.lat + (Math.random() - 0.5) * 0.04;
      const lng = c.lng + (Math.random() - 0.5) * 0.04;
      const cells = cellsForPoint(lat, lng);
      const slug = c.name.toLowerCase().replace(/\s+/g, "-");
      const email = `demo-${slug}-${i}@demo.test`;

      const [user] = await db.insert(users)
        .values({ email, displayName: `${c.name} ${i}`, city: c.name,
          homeLat: cells.snapLat, homeLng: cells.snapLng,
          h3R5: cells.r5, h3R6: cells.r6, h3R7: cells.r7, h3R8: cells.r8, h3R9: cells.r9 })
        .onConflictDoUpdate({ target: users.email, set: { city: c.name } })
        .returning({ id: users.id });

      const areaId = await ensureArea(activity.id, cells.r7,
        { city: c.name, zip: "", centerLat: cells.snapLat, centerLng: cells.snapLng });

      await db.insert(interestSignals)
        .values({ activityTypeId: activity.id, userId: user.id, areaId, h3Base: cells.r7, active: true })
        .onConflictDoNothing();
      total++;
    }
    console.log(`  seeded ${c.n} in ${c.name}`);
  }

  // mark one cluster as having a scheduled game (green accent)
  const sched = CLUSTERS.find((c) => c.scheduled)!;
  const cell = cellsForPoint(sched.lat, sched.lng).r7;
  const [area] = await db.select({ id: areas.id }).from(areas).where(eq(areas.h3Cell, cell)).limit(1);
  if (area) {
    await db.update(areas).set({ status: "SCHEDULED" }).where(eq(areas.id, area.id));
    await db.insert(games).values({
      activityTypeId: activity.id, areaId: area.id,
      placeText: "S.T. Morrison Park", scheduledStart: new Date(Date.now() + 5 * 86_400_000),
      status: "STANDING", confirmedCount: 9, isStanding: true,
    });
    console.log(`  scheduled a game in ${sched.name}`);
  }

  console.log(`done: ${total} demo interest signals`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
