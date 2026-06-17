import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, interestSignals } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { MapView } from "@/components/MapView";

export const metadata = { title: "Dashboard — MIME-FF" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/dashboard");
  const uid = session.user.id;

  const [userRows, signalRows] = await Promise.all([
    db.select({ homeLat: users.homeLat, homeLng: users.homeLng, maxTravelKm: users.maxTravelKm })
      .from(users).where(eq(users.id, uid)).limit(1),
    db.select({ id: interestSignals.id })
      .from(interestSignals)
      .where(and(eq(interestSignals.userId, uid), eq(interestSignals.active, true)))
      .limit(1),
  ]);

  // Gate: no active signal → send to show-interest
  if (!signalRows[0]) redirect("/show-interest");

  const u = userRows[0];
  const center: [number, number] = [u?.homeLng ?? -91.6, u?.homeLat ?? 41.69];
  // The user's own home + travel radius gate which clusters the cursor pulls.
  // homeLat/homeLng stay server-side except for this one user's own map.
  const home = u?.homeLat != null && u?.homeLng != null
    ? { lat: u.homeLat, lng: u.homeLng, maxTravelKm: u.maxTravelKm }
    : null;

  // Fullscreen map; the floating header/footer (app layout) sit on top.
  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} home={home} />
    </div>
  );
}
