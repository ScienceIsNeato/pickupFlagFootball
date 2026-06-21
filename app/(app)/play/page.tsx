import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { MapView } from "@/components/MapView";

export const metadata = { title: "Find a Game — MIME-FF" };

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

  // Fullscreen map; the floating header/footer (app layout) sit on top.
  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} home={home} />
    </div>
  );
}
