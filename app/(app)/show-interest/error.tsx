"use client";

import Link from "next/link";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

/** Generic error boundary for /show-interest. The corrupted-account case is
 *  rendered directly by the page (Next redacts server-thrown messages in prod,
 *  so a boundary can't reliably distinguish them); this catches unexpected
 *  render errors and points users at support. */
export default function ShowInterestError() {
  return (
    <main className="reg">
      <h1 className="reg-h">something went wrong</h1>
      <p className="reg-blurb">
        please try again in a moment. if it keeps happening, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <Link href="/" className="btn-green-link">back home</Link>
    </main>
  );
}
