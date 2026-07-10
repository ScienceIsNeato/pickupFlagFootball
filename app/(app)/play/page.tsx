import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { MapView } from "@/components/MapView";
import { MapHud } from "@/components/MapHud";
import { resolveViewerAreaScenario } from "@/lib/mime/areaScenario";
import type { EngineDb } from "@/lib/mime/engine";
import { skin } from "@/lib/skin";

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
  // invariant is ever violated (e.g. a not-yet-backfilled row). This is just
  // the first paint; MapHud polls /api/hud client-side to stay live after the
  // viewer proposes, joins, or otherwise changes the area's state.
  const resolved = await resolveViewerAreaScenario(edb(), skin.slug, uid);
  const scenario = resolved?.scenario ?? null;
  const areaPlace = resolved?.place ?? null;

  // Fullscreen map; the floating header/footer (app layout) sit on top.
  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} home={home} />
      {scenario ? (
        <MapHud scenario={scenario} place={areaPlace} />
      ) : (
        // No scenario → no location/interest on file. Don't leave a bare map:
        // point the user at setting their area so the map + proposing work.
        <div className="map-hud">
          <p className="map-hud-h">set your location to get started</p>
          <p className="map-hud-body">
            tell us your general area and we&apos;ll show games forming near you — and
            let you propose one.
          </p>
          <Link href="/account" className="btn-green-link">set your location</Link>
        </div>
      )}
    </div>
  );
}
