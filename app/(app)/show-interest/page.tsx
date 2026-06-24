import Link from "next/link";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import { RegisterInterestForm } from "@/components/RegisterInterestForm";
import { hasActiveInterest } from "@/lib/db/interest";

export const metadata = {
  title: skin.register.seoTitle,
  description: skin.register.seoDescription,
};

export default async function ShowInterestPage() {
  const session = await auth();
  const uid = session?.user?.id;

  // Anonymous visitors land here as the registration window: account + location +
  // interest in one atomic step (the only place an account is created).
  if (!uid) {
    return (
      <main className="reg">
        <Link href="/" className="back">&larr; back</Link>
        <h1 className="reg-h">{skin.register.heading}</h1>
        <p className="reg-blurb">{skin.register.blurb}</p>
        <RegisterInterestForm />
      </main>
    );
  }

  // Logged in ⇒ registered ⇒ (by invariant) has an active interest signal, since
  // createMember writes the user + interest together and no other path mints an
  // account. Confirm it and point them at their games — this is no longer an
  // onboarding step.
  if (await hasActiveInterest(uid)) {
    return (
      <main className="reg">
        <Link href="/play" className="back">&larr; back</Link>
        <h1 className="reg-h">you&apos;re all set</h1>
        <p className="reg-blurb">
          you&apos;ve shown interest in your area. edit your location anytime from your{" "}
          <Link href="/account">account</Link>.
        </p>
        <Link href="/my-games" className="btn-green-link">take me to my games</Link>
      </main>
    );
  }

  // A registered user with NO interest is supposed to be impossible. If we reach
  // here, the account is corrupted — fail loud (→ error.tsx) for manual
  // resolution rather than silently re-onboarding them.
  throw new Error("CORRUPTED_ACCOUNT: registered user has no active interest");
}
