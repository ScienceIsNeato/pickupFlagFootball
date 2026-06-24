"use client";

import Link from "next/link";

/** Error boundary for /show-interest. The page throws CORRUPTED_ACCOUNT when a
 *  logged-in (registered) user somehow has no interest — an invariant violation
 *  that should be impossible. Surface it plainly for manual resolution instead
 *  of silently re-onboarding. */
export default function ShowInterestError({ error }: { error: Error & { digest?: string } }) {
  const corrupted = error.message?.includes("CORRUPTED_ACCOUNT");
  return (
    <main className="reg">
      <h1 className="reg-h">{corrupted ? "corrupted account" : "something went wrong"}</h1>
      <p className="reg-blurb">
        {corrupted ? (
          <>
            your account is registered but has no interest on file — a state that shouldn&apos;t be
            possible. this needs manual resolution; please reach out so we can fix it.
          </>
        ) : (
          <>please try again in a moment.</>
        )}
      </p>
      <Link href="/" className="btn-green-link">back home</Link>
    </main>
  );
}
