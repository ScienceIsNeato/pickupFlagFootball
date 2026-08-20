import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { latLngToCell } from "h3-js";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ProposeForm } from "@/components/ProposeForm";

// Propose-a-game as a page (redesign decision B2), reached from the map's
// + button, a long-press, or a right-click — ?lat&lng pin the picked spot.

export const metadata = { title: "Propose a Game - MIME-FF" };

const PROPOSE_RES = 7; // proposeGame resolves areas by r7 cell — match MapView

export default async function ProposePage({ searchParams }: { searchParams: Promise<{ lat?: string; lng?: string }> }) {
  const session = await auth();
  const sp = await searchParams;
  const lat = Number(sp.lat), lng = Number(sp.lng);
  // Deep links survive sign-in: preserve the full path INCLUDING the query
  // (encoded - it contains &), so a shared propose link completes after login.
  if (!session?.user?.id) redirect(`/?signin=1&next=${encodeURIComponent(`/propose?lat=${sp.lat}&lng=${sp.lng}`)}`);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) notFound();

  // Same home shape the play page derives — the form leads with an actionable
  // out-of-range message when the picked spot is beyond the travel radius.
  const [u] = await db.select({ homeLat: users.homeLat, homeLng: users.homeLng,
    maxTravelKm: users.maxTravelKm, city: users.city, zip: users.zip })
    .from(users).where(eq(users.id, session.user.id)).limit(1);
  const home = u?.homeLat != null && u?.homeLng != null
    ? { lat: u.homeLat, lng: u.homeLng, maxTravelKm: u.maxTravelKm, city: u.city ?? null, zip: u.zip ?? null }
    : null;

  return (
    <main className="game-page">
      <Link href="/play" className="back">&larr; back to the map</Link>
      <ProposeForm h3={latLngToCell(lat, lng, PROPOSE_RES)} center={{ lat, lng }} home={home} />
    </main>
  );
}
