import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, interestSignals } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { MapView } from "@/components/MapView";

export const metadata = { title: "Dashboard — MIME-FF" };

export default async function DashboardPage() {
  const session = await auth();
  const uid = session?.user?.id!;

  const [userRows, signalRows] = await Promise.all([
    db.select({ homeLat: users.homeLat, homeLng: users.homeLng })
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

  // Fullscreen map; the floating header/footer (app layout) sit on top.
  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} />
    </div>
  );
}
