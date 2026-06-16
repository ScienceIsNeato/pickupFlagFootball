import Link from "next/link";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
        <button type="submit" className="btn-green">{skin.register.cta}</button>
        <p className="reg-note">{skin.register.note}</p>
      </form>
    </main>
  );
}
