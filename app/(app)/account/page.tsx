import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { kmToMiles } from "@/lib/geo";
import { skin } from "@/lib/skin";
import { updateAccount, updateDonationPref } from "./actions";

export const metadata = { title: "Account — MIME-FF" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/account");
  const uid = session.user.id;

  const rows = await db
    .select({
      displayName: users.displayName,
      addressLine1: users.addressLine1, addressLine2: users.addressLine2,
      city: users.city, state: users.state, zip: users.zip,
      maxTravelKm: users.maxTravelKm,
      donationStatus: users.donationStatus,
    })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  const u = rows[0] ?? {
    displayName: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", maxTravelKm: 24.14,
    donationStatus: "unset" as const,
  };
  const travelMiles = Math.round(kmToMiles(u.maxTravelKm ?? 24.14)); // ~15 mi default

  return (
    <main className="reg">
      <Link href="/play" className="back">&larr; find a game</Link>
      <h1 className="reg-h">your account</h1>
      <p className="reg-blurb">
        signed in as <strong>{session?.user?.email}</strong>.
        update your display name or location here.
      </p>
      <form className="reg-form" action={updateAccount}>
        <label>
          display name
          <input
            type="text"
            name="displayName"
            placeholder="first name or nickname"
            defaultValue={u.displayName ?? ""}
            autoComplete="given-name"
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
            defaultValue={u.zip ?? ""}
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
            defaultValue={u.addressLine1 ?? ""}
          />
        </label>
        <label>
          apt / suite / unit
          <input
            type="text"
            name="address_line2"
            placeholder="Apt 4"
            autoComplete="address-line2"
            defaultValue={u.addressLine2 ?? ""}
          />
        </label>
        <div className="reg-row">
          <label>
            city
            <input
              type="text"
              name="city"
              placeholder="Coralville"
              defaultValue={u.city ?? ""}
              autoComplete="address-level2"
            />
          </label>
          <label className="reg-state">
            state
            <input
              type="text"
              name="state"
              placeholder="IA"
              maxLength={20}
              defaultValue={u.state ?? ""}
              autoComplete="address-level1"
            />
          </label>
        </div>
        <label>
          how far will you travel? (miles)
          <input
            type="number"
            name="max_travel_miles"
            min="1"
            max="100"
            step="1"
            defaultValue={travelMiles}
            inputMode="numeric"
          />
        </label>
        <p className="reg-hint">
          your address and travel distance are only used to measure how far games
          are from you — never shown to anyone. <Link href="/privacy">privacy</Link>.
        </p>
        <button type="submit" className="btn-green">save changes</button>
      </form>

      <form className="reg-form donate-pref" action={updateDonationPref}>
        <p className="reg-section">supporting the project</p>
        <p className="reg-hint">
          this app is free and pay-what-you-can. if it&apos;s running your weekly game,
          a <Link href={skin.donate.url}>$5/month donation</Link> keeps the servers on —
          but it&apos;s an ask, not a gate. let us know where you stand so we only remind
          you if you want us to.
        </p>
        <label className="donate-opt">
          <input type="radio" name="donation_status" value="unset" defaultChecked={u.donationStatus === "unset"} />
          <span>remind me later</span>
        </label>
        <label className="donate-opt">
          <input type="radio" name="donation_status" value="subscribed" defaultChecked={u.donationStatus === "subscribed"} />
          <span>i&apos;m chipping in $5/month — no need to remind me</span>
        </label>
        <label className="donate-opt">
          <input type="radio" name="donation_status" value="declined" defaultChecked={u.donationStatus === "declined"} />
          <span>i&apos;d rather not donate — stop asking</span>
        </label>
        <button type="submit" className="btn-green">save preference</button>
      </form>
    </main>
  );
}
