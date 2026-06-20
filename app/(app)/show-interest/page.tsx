import Link from "next/link";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { RegisterInterestForm } from "@/components/RegisterInterestForm";
import { LocationForm } from "@/components/LocationForm";
import { hasActiveInterest } from "@/lib/db/interest";

export const metadata = {
  title: skin.register.seoTitle,
  description: skin.register.seoDescription,
};

export default async function ShowInterestPage() {
  const session = await auth();
  const uid = session?.user?.id;

  // Anonymous visitors land here as the registration window: account + interest
  // in one step. Signed-in users get the location-only form below.
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

  // Already set up (registered AND shown interest): the form is redundant —
  // location lives on the account page now. Point them at their games instead.
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

  // Logged in but no interest yet (e.g. just signed in with Google): finish
  // onboarding with the location form.
  const u = (await db
    .select({
      line1: users.addressLine1, line2: users.addressLine2,
      city: users.city, state: users.state, zip: users.zip,
    })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1))[0];

  return (
    <main className="reg">
      <Link href="/play" className="back">&larr; back</Link>
      <h1 className="reg-h">{skin.register.heading}</h1>
      <p className="reg-blurb">{skin.register.blurb}</p>
      <LocationForm
        initial={{
          zip: u?.zip ?? "", line1: u?.line1 ?? "", line2: u?.line2 ?? "",
          city: u?.city ?? "", state: u?.state ?? "",
        }}
        cta={skin.register.cta}
        note={skin.register.note}
      />
    </main>
  );
}
