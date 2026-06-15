import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, interestSignals, activityTypes, mapAggregates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const metadata = { title: "Dashboard — MIME-FF" };

export default async function DashboardPage() {
  const session = await auth();
  const uid = session?.user?.id!;

  // Load user + check for active interest signal (server-enforced gate)
  const [userRows, signalRows, activityRows] = await Promise.all([
    db.select({ city: users.city, zip: users.zip, h3R7: users.h3R7 })
      .from(users).where(eq(users.id, uid)).limit(1),
    db.select({ id: interestSignals.id, areaId: interestSignals.areaId, h3Base: interestSignals.h3Base })
      .from(interestSignals)
      .where(and(eq(interestSignals.userId, uid), eq(interestSignals.active, true)))
      .limit(1),
    db.select({ id: activityTypes.id })
      .from(activityTypes).where(eq(activityTypes.slug, "flag-football")).limit(1),
  ]);

  const u = userRows[0];
  const signal = signalRows[0];

  // Gate: no active signal → send to show-interest
  if (!signal) redirect("/show-interest");

  // Nearby count from map_aggregates at r7 resolution
  let nearbyCount = 0;
  if (signal.h3Base && activityRows.length) {
    const agg = await db
      .select({ interestCount: mapAggregates.interestCount })
      .from(mapAggregates)
      .where(
        and(
          eq(mapAggregates.activityTypeId, activityRows[0].id),
          eq(mapAggregates.resolution, 7),
          eq(mapAggregates.h3Cell, signal.h3Base)
        )
      )
      .limit(1);
    nearbyCount = agg[0]?.interestCount ?? 0;
  }

  const location = u?.city && u?.zip ? `${u.city}, ${u.zip}` : u?.zip ?? "your area";

  return (
    <main className="reg">
      <h1 className="reg-h">you&apos;re in</h1>
      <p className="reg-blurb">
        you&apos;re signed up for pickup flag football near <strong>{location}</strong>.
        when enough people in your area show interest, we&apos;ll reach out.
      </p>

      {nearbyCount > 0 ? (
        <p className="reg-blurb">
          <strong>{nearbyCount}</strong> {nearbyCount === 1 ? "person" : "people"} interested in your area so far.
        </p>
      ) : (
        <p className="reg-blurb" style={{ color: "var(--muted)" }}>
          you&apos;re the first in your area — spread the word.
        </p>
      )}

      <p className="reg-blurb" style={{ marginTop: 32 }}>
        <Link href="/account">update your location or name →</Link>
      </p>
    </main>
  );
}
