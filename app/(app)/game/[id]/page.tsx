import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games } from "@/lib/db/schema";
import { GameCard } from "@/components/GameCard";

// A game is a page with a URL (redesign decision B2) — shareable, back-button
// friendly, and reachable without the map canvas (the audit's M1 blocker).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Game - MIME-FF" };
  const [g] = await db.select({ placeText: games.placeText }).from(games).where(eq(games.id, id)).limit(1);
  return { title: g ? `${g.placeText.split(" — ")[0]} - MIME-FF` : "Game - MIME-FF" };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) redirect(`/?signin=1&next=/game/${id}`);
  if (!UUID.test(id)) notFound();

  return (
    <main className="game-page">
      <Link href="/play" className="back">&larr; back to the map</Link>
      <GameCard gameId={id} />
    </main>
  );
}
