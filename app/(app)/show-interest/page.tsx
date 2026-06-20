import Link from "next/link";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { setLocationAndInterest } from "./actions";
import { RegisterInterestForm } from "@/components/RegisterInterestForm";
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
      <form className="reg-form" action={setLocationAndInterest}>
        <label>
          zip code
          <input
            type="text"
            name="zip"
            placeholder="52241"
            inputMode="numeric"
            autoComplete="postal-code"
            pattern="[0-9]{5}"
            required
            defaultValue={u?.zip ?? ""}
          />
        </label>
        <p className="reg-section">your address <span className="reg-optional">(optional — sharpens distance to games)</span></p>
        <label>
          street address
          <input
            type="text"
            name="address_line1"
            placeholder="1806 Brown Deer Trail"
            autoComplete="address-line1"
            defaultValue={u?.line1 ?? ""}
          />
        </label>
        <label>
          apt / suite / unit
          <input
            type="text"
            name="address_line2"
            placeholder="Apt 4"
            autoComplete="address-line2"
            defaultValue={u?.line2 ?? ""}
          />
        </label>
        <div className="reg-row">
          <label>
            city
            <input
              type="text"
              name="city"
              placeholder="Coralville"
              autoComplete="address-level2"
              defaultValue={u?.city ?? ""}
            />
          </label>
          <label className="reg-state">
            state
            <input
              type="text"
              name="state"
              placeholder="IA"
              autoComplete="address-level1"
              maxLength={20}
              defaultValue={u?.state ?? ""}
            />
          </label>
        </div>
        <p className="reg-hint">
          we only use your address to measure how far games are from you. we never
          show it to anyone or sell it — see our <Link href="/privacy">privacy page</Link>.
        </p>
        <button type="submit" className="btn-green">{skin.register.cta}</button>
        <p className="reg-note">{skin.register.note}</p>
      </form>
    </main>
  );
}
