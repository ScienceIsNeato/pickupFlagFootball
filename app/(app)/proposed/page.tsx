import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { ProposedCard } from "@/components/ProposedCard";

// A forming site is a page (redesign decision B2), keyed by its venue
// coordinates to match /api/proposed — attempts churn, coordinates don't.

export const metadata = { title: "Proposed Game - MIME-FF" };

export default async function ProposedPage({ searchParams }: { searchParams: Promise<{ lat?: string; lng?: string }> }) {
  const session = await auth();
  const sp = await searchParams;
  const lat = Number(sp.lat), lng = Number(sp.lng);
  if (!session?.user?.id) redirect(`/?signin=1&next=/play`);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) notFound();

  return (
    <main className="game-page">
      <Link href="/play" className="back">&larr; back to the map</Link>
      <ProposedCard lat={lat} lng={lng} />
    </main>
  );
}
