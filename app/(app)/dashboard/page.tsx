import Link from "next/link";
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
    db.select({ city: users.city, zip: users.zip, homeLat: users.homeLat, homeLng: users.homeLng })
      .from(users).where(eq(users.id, uid)).limit(1),
    db.select({ id: interestSignals.id })
      .from(interestSignals)
      .where(and(eq(interestSignals.userId, uid), eq(interestSignals.active, true)))
      .limit(1),
  ]);

  const u = userRows[0];
  const signal = signalRows[0];

  // Gate: no active signal → send to show-interest
  if (!signal) redirect("/show-interest");

  const location = u?.city && u?.zip ? `${u.city}, ${u.zip}` : u?.zip ?? "your area";
  const center: [number, number] = [u?.homeLng ?? -91.6, u?.homeLat ?? 41.69];

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <h1 style={{ fontFamily: "var(--font-barlow), sans-serif", fontSize: 30, fontWeight: 700, margin: 0 }}>
          you&apos;re in
        </h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 15 }}>
          pickup flag football near <strong style={{ color: "var(--ink)" }}>{location}</strong>.
          when enough people nearby show interest, we&apos;ll reach out.
        </p>
        <Link href="/account" style={{ marginLeft: "auto", fontSize: 14 }}>account →</Link>
      </div>

      <div style={{
        height: "68vh", minHeight: 420, borderRadius: 14, overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        <MapView center={center} zoom={9} />
      </div>

      <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 12 }}>
        each football is interested players in an area — zoom out and they merge, zoom in and they split.
        gold is gathering interest; green means a game is on.
      </p>
    </main>
  );
}
