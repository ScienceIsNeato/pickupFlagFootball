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

  const u = uid
    ? (await db
        .select({
          line1: users.addressLine1, line2: users.addressLine2,
          city: users.city, state: users.state, zip: users.zip,
        })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1))[0]
    : undefined;

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
