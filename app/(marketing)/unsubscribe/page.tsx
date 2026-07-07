import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribeLink";
import { applyUnsubscribe, applyResubscribe } from "./actions";

export const metadata = { title: "unsubscribe - MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * Footer "unsubscribe" landing. Status is read from the DB (the user's real
 * email_opt_in), never a query param — so a crafted URL can't show a fake
 * "unsubscribed". The GET is read-only (shows a button that POSTs, see
 * actions.ts) so mail link-scanners hitting the GET can't opt anyone out. The
 * signed token is the auth (no session).
 */
export default async function UnsubscribePage({
  searchParams,
}: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const userId = t ? verifyUnsubscribeToken(t) : null;

  const invalid = (
    <main className="prose">
      <h1>this link didn&apos;t work</h1>
      <p>it may have been altered. manage your emails from your <Link href="/account">account</Link>.</p>
    </main>
  );
  if (!userId) return invalid;

  const [u] = await db.select({ optIn: users.emailOptIn }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return invalid;

  if (!u.optIn) {
    return (
      <main className="prose">
        <h1>you&apos;re unsubscribed</h1>
        <p>we won&apos;t email you about games. changed your mind?</p>
        <form action={applyResubscribe}>
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="btn-green">re-subscribe</button>
        </form>
        <p>you can also manage this anytime in your <Link href="/account">account</Link>.</p>
      </main>
    );
  }

  return (
    <main className="prose">
      <h1>unsubscribe from emails?</h1>
      <p>
        we&apos;ll stop emailing you about games forming and running near you. you can
        re-subscribe anytime, here or from your <Link href="/account">account</Link>.
      </p>
      <form action={applyUnsubscribe}>
        <input type="hidden" name="t" value={t} />
        <button type="submit" className="btn-green">yes, stop emailing me</button>
      </form>
    </main>
  );
}
