import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gameOccurrences } from "@/lib/db/schema";
import { verifyRsvpToken } from "@/lib/rsvpLink";
import { applyRsvp } from "./actions";

export const metadata = { title: "rsvp — MIME-FF" };
export const dynamic = "force-dynamic";

const fmtDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

/**
 * One-click RSVP landing for the weekly status email's "play after all" / "bail"
 * links. The signed token is the auth (no session). The GET here is read-only —
 * it shows a confirm button that POSTs (see actions.ts), so mail link-scanners
 * and prefetchers that hit the GET can't flip anyone's attendance.
 */
export default async function RsvpPage({
  searchParams,
}: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t, done } = await searchParams;

  // After the POST: a confirmation message.
  if (done) {
    const copy: Record<string, { title: string; body: string }> = {
      in: { title: "you're in", body: "great — we've marked you in for this week's game." },
      out: { title: "you're out", body: "thanks for letting us know — it helps the others plan." },
      cancelled: { title: "game called off", body: "this week's game was called off, so there's nothing to rsvp to." },
      invalid: { title: "this rsvp link didn't work", body: "it may have expired or been altered." },
    };
    const c = copy[done] ?? copy.invalid;
    return (
      <main className="prose">
        <h1>{c.title}</h1>
        <p>{c.body} manage it anytime from <Link href="/my-games">your games</Link>.</p>
      </main>
    );
  }

  const parsed = t ? verifyRsvpToken(t) : null;
  let dateLabel = "";
  if (parsed) {
    const [occ] = await db.select({ date: gameOccurrences.occurrenceDate })
      .from(gameOccurrences).where(eq(gameOccurrences.id, parsed.occurrenceId)).limit(1);
    if (occ) dateLabel = fmtDate(occ.date);
  }

  if (!parsed || !dateLabel) {
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

  const verb = parsed.action === "in" ? "in" : "out";
  return (
    <main className="prose">
      <h1>rsvp for {dateLabel}</h1>
      <p>tap confirm to mark yourself <strong>{verb}</strong> for this week&apos;s game.</p>
      <form action={applyRsvp}>
        <input type="hidden" name="t" value={t} />
        <button type="submit" className="btn-green">confirm — i&apos;m {verb}</button>
      </form>
    </main>
  );
}
