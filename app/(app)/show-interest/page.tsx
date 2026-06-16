import Link from "next/link";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { LocationPicker } from "@/components/LocationPicker";
import { setLocationAndInterest } from "./actions";

export const metadata = {
  title: skin.register.seoTitle,
  description: skin.register.seoDescription,
};

export default async function ShowInterestPage() {
  const session = await auth();
  const uid = session?.user?.id;

  let currentZip = "";
  let currentCity = "";
  if (uid) {
    const rows = await db
      .select({ zip: users.zip, city: users.city })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    currentZip = rows[0]?.zip ?? "";
    currentCity = rows[0]?.city ?? "";
  }

  return (
    <main className="reg">
      <Link href="/dashboard" className="back">&larr; back</Link>
      <h1 className="reg-h">{skin.register.heading}</h1>
      <p className="reg-blurb">{skin.register.blurb}</p>
      <form className="reg-form" action={setLocationAndInterest}>
        <label>
          city
          <input
            type="text"
            name="city"
            placeholder="Coralville"
            autoComplete="address-level2"
            defaultValue={currentCity}
          />
        </label>
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
            defaultValue={currentZip}
          />
        </label>
        <label>
          your address <span className="reg-optional">(optional)</span>
          <LocationPicker name="home_addr" required={false} placeholder="search where you actually live" />
        </label>
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
