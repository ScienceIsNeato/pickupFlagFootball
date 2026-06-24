import Link from "next/link";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import { RegisterInterestForm } from "@/components/RegisterInterestForm";
import { hasActiveInterest } from "@/lib/db/interest";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

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

  // A registered user with NO interest is supposed to be impossible (createMember
  // writes both atomically; no path mints a bare account). If we reach here the
  // account is corrupted — surface it plainly for manual resolution rather than
  // silently re-onboarding. Rendered directly (not thrown): Next redacts
  // server-thrown error messages in prod, so an error boundary couldn't show this.
  return (
    <main className="reg">
      <h1 className="reg-h">corrupted account</h1>
      <p className="reg-blurb">
        your account is registered but has no interest on file — a state that shouldn&apos;t be
        possible. it needs manual resolution: email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll sort it out.
      </p>
      <Link href="/" className="btn-green-link">back home</Link>
    </main>
  );
}
