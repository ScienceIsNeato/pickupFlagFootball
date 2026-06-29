import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { formationAttempts } from "@/lib/db/schema";
import { verifyInterestToken } from "@/lib/interestLink";
import { applyInterest } from "./actions";

export const metadata = { title: "interested? — MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * One-click landing for a proposal email's "i'm interested" / "not interested"
 * links. The signed token is the auth (no session). The GET is read-only — it
 * shows a confirm button that POSTs (see actions.ts), so link-scanners that hit
 * the GET can't record a response.
 */
export default async function InterestedPage({
  searchParams,
}: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t, done } = await searchParams;

  if (done) {
    const copy: Record<string, { title: string; body: string }> = {
      in: { title: "you're in", body: "nice — we've counted you in. if enough people are in by the deadline, the game's on and you'll get a heads-up." },
      out: { title: "no worries", body: "we won't count you toward this one. you'll still hear about other games proposed near you." },
      closed: { title: "this one's settled", body: "the interest window for this proposal has already closed." },
      invalid: { title: "this link didn't work", body: "it may have expired or been altered." },
    };
    const c = copy[done] ?? copy.invalid;
    return (
      <main className="prose">
        <h1>{c.title}</h1>
        <p>{c.body} find more games on <Link href="/play">the map</Link>.</p>
      </main>
    );
  }

  const parsed = t ? verifyInterestToken(t) : null;
  let place = "";
  if (parsed) {
    const [att] = await db.select({ placeText: formationAttempts.placeText, status: formationAttempts.status })
      .from(formationAttempts).where(eq(formationAttempts.id, parsed.attemptId)).limit(1);
    if (att && att.status === "OPEN") place = att.placeText.split(" — ")[0];
  }

  if (!parsed || !place) {
    return (
      <main className="prose">
        <h1>this link didn&apos;t work</h1>
        <p>it may have expired, been altered, or the proposal already closed. find games on <Link href="/play">the map</Link>.</p>
      </main>
    );
  }

  const verb = parsed.action === "in" ? "interested in" : "not interested in";
  return (
    <main className="prose">
      <h1>{parsed.action === "in" ? "count me in" : "not this one"}</h1>
      <p>tap confirm to say you&apos;re <strong>{verb}</strong> the game proposed at {place}.</p>
      <form action={applyInterest}>
        <input type="hidden" name="t" value={t} />
        <button type="submit" className="btn-green">confirm</button>
      </form>
    </main>
  );
}
