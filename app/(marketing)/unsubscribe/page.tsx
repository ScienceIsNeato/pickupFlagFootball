import Link from "next/link";
import { verifyUnsubscribeToken } from "@/lib/unsubscribeLink";
import { applyUnsubscribe, applyResubscribe } from "./actions";

export const metadata = { title: "unsubscribe - MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * Footer "unsubscribe" landing. The GET is read-only — it shows a confirm button
 * that POSTs (see actions.ts) so mail link-scanners hitting the GET can't opt
 * anyone out. The signed token is the auth (no session).
 */
export default async function UnsubscribePage({
  searchParams,
}: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t, done } = await searchParams;

  if (done === "off") {
    return (
      <main className="prose">
        <h1>you&apos;re unsubscribed</h1>
        <p>we won&apos;t email you about games anymore. changed your mind?</p>
        {t ? (
          <form action={applyResubscribe}>
            <input type="hidden" name="t" value={t} />
            <button type="submit" className="btn-green">re-subscribe</button>
          </form>
        ) : null}
        <p>you can also manage this anytime in your <Link href="/account">account</Link>.</p>
      </main>
    );
  }
  if (done === "on") {
    return (
      <main className="prose">
        <h1>you&apos;re back on the list</h1>
        <p>we&apos;ll email you about games near you again. manage it anytime in your <Link href="/account">account</Link>.</p>
      </main>
    );
  }
  if (done === "invalid" || !t || !verifyUnsubscribeToken(t)) {
    return (
      <main className="prose">
        <h1>this link didn&apos;t work</h1>
        <p>it may have been altered. manage your emails from your <Link href="/account">account</Link>.</p>
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
