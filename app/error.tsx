"use client";

import Link from "next/link";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

/**
 * Error boundary for any page/segment without a closer one (the marketing pages
 * and anything else under the root layout). Server-side throws are already
 * reported to Sentry via instrumentation's onRequestError; this is the branded
 * fallback the user sees, with a retry and a way out.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="prose">
      <h1>something went wrong</h1>
      <p>
        that&apos;s on us, not you. try again in a moment — if it keeps happening,
        email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p>
        <button type="button" className="btn-green" onClick={reset}>try again</button>{" "}
        <Link href="/">back home</Link>
      </p>
    </main>
  );
}
