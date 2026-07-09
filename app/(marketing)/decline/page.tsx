import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { areas } from "@/lib/db/schema";
import { verifyDeclineToken } from "@/lib/declineLink";
import { applyDecline } from "./actions";

export const metadata = { title: "not interested - MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * One-click "not interested in this site" landing for the formation courting
 * emails. The signed token is the auth (no session). The GET is read-only — it
 * shows a confirm button that POSTs (see actions.ts), so mail link-scanners and
 * prefetchers that hit the GET can't silently opt anyone out.
 */
export default async function DeclinePage({
  searchParams,
}: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t, done } = await searchParams;

  if (done) {
    const copy: Record<string, { title: string; body: string }> = {
      ok: { title: "you're out for this site", body: "we won't count you toward it or email you about games forming there. you'll still hear about other games near you." },
      gone: { title: "nothing to opt out of", body: "this site is no longer forming a game." },
      invalid: { title: "this link didn't work", body: "it may have expired or been altered." },
    };
    const c = copy[done] ?? copy.invalid;
    return (
      <main className="prose">
        <h1>{c.title}</h1>
        <p>{c.body} manage everything anytime from your <Link href="/account">account</Link>.</p>
      </main>
    );
  }

  const parsed = t ? verifyDeclineToken(t) : null;
  if (!parsed) {
    return (
      <main className="prose">
        <h1>this link didn&apos;t work</h1>
        <p>it may have expired or been altered. manage your games from your <Link href="/account">account</Link>.</p>
      </main>
    );
  }

  const [area] = await db.select({ city: areas.displayCity, zip: areas.displayZip })
    .from(areas).where(eq(areas.id, parsed.areaId)).limit(1);
  const where = area?.city ? `${area.city}${area.zip ? ` (${area.zip})` : ""}` : "this site";

  return (
    <main className="prose">
      <h1>not interested in this site?</h1>
      <p>
        we&apos;ll stop counting you toward - and stop emailing you about - games forming at{" "}
        <strong>{where}</strong>. you&apos;ll still hear about other games near you, and you can
        change your mind anytime from your <a href="/account">account</a>.
      </p>
      <form action={applyDecline}>
        <input type="hidden" name="t" value={t} />
        <button type="submit" className="btn-green">yes, stop emailing me about this site</button>
      </form>
    </main>
  );
}
