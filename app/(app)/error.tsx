"use client";

import Link from "next/link";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

/** Closer error boundary for the signed-in app pages (/play, /my-games,
 *  /account). Keeps the app chrome and offers a retry + a way back to the map. */
export default function AppGroupError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="prose">
      <h1>something went wrong</h1>
      <p>
        we hit a snag loading this. try again — if it persists, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p>
        <button type="button" className="btn-green" onClick={reset}>try again</button>{" "}
        <Link href="/play">back to the map</Link>
      </p>
    </main>
  );
}
