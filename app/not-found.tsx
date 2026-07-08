import Link from "next/link";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

export const metadata = { title: "not found - MIME-FF" };

/** Branded 404 for any unmatched URL (typo, stale share link, old path). */
export default function NotFound() {
  return (
    <main className="prose">
      <h1>we couldn&apos;t find that page</h1>
      <p>
        the link may be old or mistyped. head back to the{" "}
        <Link href="/">home page</Link>, jump to the{" "}
        <Link href="/play">map</Link>, or check the{" "}
        <Link href="/faq">faq</Link>.
      </p>
      <p>
        still stuck? email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p><Link href="/" className="btn-green">back home</Link></p>
    </main>
  );
}
