import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, activityTypes, interestSignals, areas } from "@/lib/db/schema";
import { MapView } from "@/components/MapView";
import { MapHud } from "@/components/MapHud";
import { detectAreaScenario, type AreaScenario } from "@/lib/mime/areaScenario";
import type { EngineDb } from "@/lib/mime/engine";

export const metadata = { title: "Find a Game - MIME-FF" };

// Read-only engine call against the one-shot client — no transaction, so the
// neon-http/txnDb split that writes care about doesn't apply here.
const edb = () => db as unknown as EngineDb;

export default async function PlayPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/play");
  const uid = session.user.id;

  // The map is open to any signed-in user; if they haven't set a location yet it
  // just renders centered on the region (no personal radius). They set location
  // via show-interest / account to personalize and to join.
  const [u] = await db.select({ homeLat: users.homeLat, homeLng: users.homeLng, maxTravelKm: users.maxTravelKm,
                city: users.city, zip: users.zip })
      .from(users).where(eq(users.id, uid)).limit(1);
  const center: [number, number] = [u?.homeLng ?? -91.6, u?.homeLat ?? 41.69];
  // The user's own home + travel radius gate which clusters the cursor pulls.
  // homeLat/homeLng stay server-side except for this one user's own map.
  const home = u?.homeLat != null && u?.homeLng != null
    ? { lat: u.homeLat, lng: u.homeLng, maxTravelKm: u.maxTravelKm,
        city: u.city ?? null, zip: u.zip ?? null }
    : null;

  // The HUD: "what's my situation here, what do I do next" — derived from the
  // viewer's OWN area (their active interest signal — home IS their interest).
  // Every signed-up user has one, but render nothing rather than guess if that
  // invariant is ever violated (e.g. a not-yet-backfilled row).
  let scenario: AreaScenario | null = null;
  let areaPlace: { city: string | null; zip: string | null } | null = null;
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (act) {
    const [mine] = await db.select({ areaId: interestSignals.areaId }).from(interestSignals)
      .where(and(eq(interestSignals.userId, uid), eq(interestSignals.active, true))).limit(1);
    if (mine) {
      scenario = await detectAreaScenario(edb(), act.id, mine.areaId, uid);
      const [area] = await db.select({ city: areas.displayCity, zip: areas.displayZip })
        .from(areas).where(eq(areas.id, mine.areaId)).limit(1);
      areaPlace = area ?? null;
    }
  }

  // Fullscreen map; the floating header/footer (app layout) sit on top.
  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} home={home} />
      {scenario && <MapHud scenario={scenario} place={areaPlace} />}
    </div>
  );
}
