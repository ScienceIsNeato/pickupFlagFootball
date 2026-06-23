import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gameOccurrences, gameAttendance } from "@/lib/db/schema";
import { verifyRsvpToken } from "@/lib/rsvpLink";

export const metadata = { title: "rsvp — MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * One-click RSVP landing for the weekly status email's "play after all" / "bail"
 * links. The signed token is the auth (no session needed) — we verify it, then
 * upsert this week's attendance row for that user. See lib/rsvpLink.ts.
 */
export default async function RsvpPage({
  searchParams,
}: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const parsed = t ? verifyRsvpToken(t) : null;

  let ok = false;
  let action: "in" | "out" | null = null;
  let dateLabel = "";
  if (parsed) {
    const [occ] = await db.select({ gameId: gameOccurrences.gameId, date: gameOccurrences.occurrenceDate })
      .from(gameOccurrences).where(eq(gameOccurrences.id, parsed.occurrenceId)).limit(1);
    if (occ) {
      await db.insert(gameAttendance)
        .values({ gameId: occ.gameId, userId: parsed.userId, occurrenceDate: occ.date, status: parsed.action })
        .onConflictDoUpdate({
          target: [gameAttendance.gameId, gameAttendance.userId, gameAttendance.occurrenceDate],
          set: { status: parsed.action },
        });
      ok = true;
      action = parsed.action;
      dateLabel = new Date(`${occ.date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "long", month: "short", day: "numeric",
      });
    }
  }

  if (!ok) {
    return (
      <main className="prose">
        <h1>this rsvp link didn&apos;t work</h1>
        <p>
          it may have expired or been altered. you can always set your status from{" "}
          <Link href="/my-games">your games</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="prose">
      <h1>{action === "in" ? "you're in" : "you're out"} for {dateLabel}</h1>
      <p>
        {action === "in"
          ? "great — we've marked you in for this week's game."
          : "thanks for letting us know — we've marked you out for this week. it helps the others plan."}{" "}
        manage it anytime from <Link href="/my-games">your games</Link>.
      </p>
    </main>
  );
}
