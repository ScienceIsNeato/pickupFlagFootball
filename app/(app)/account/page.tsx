import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, gameRoster, games, areas, areaCaptains } from "@/lib/db/schema";
import { kmToMiles } from "@/lib/geo";
import { skin } from "@/lib/skin";
import { AccountForm } from "@/components/AccountForm";
import { ChangeEmail } from "@/components/ChangeEmail";
import { updateDonationPref } from "./actions";
import { openBillingPortal } from "@/app/(marketing)/donate/actions";

export const metadata = { title: "Account - MIME-FF" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/account");
  const uid = session.user.id;

  const [u] = await db
    .select({
      email: users.email, emailVerified: users.emailVerified, passwordHash: users.passwordHash,
      displayName: users.displayName,
      addressLine1: users.addressLine1, addressLine2: users.addressLine2,
      city: users.city, state: users.state, zip: users.zip,
      maxTravelKm: users.maxTravelKm,
      emailOptIn: users.emailOptIn,
      donationStatus: users.donationStatus,
      stripeSubscriptionId: users.stripeSubscriptionId,
    })
    .from(users).where(eq(users.id, uid)).limit(1);
  const me = u ?? {
    email: session.user.email ?? "", emailVerified: null, passwordHash: null,
    displayName: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", maxTravelKm: 24.14,
    emailOptIn: true, donationStatus: "unset" as const, stripeSubscriptionId: null,
  };
  const travelMiles = Math.round(kmToMiles(me.maxTravelKm ?? 24.14));
  const supporting = me.donationStatus === "subscribed";

  // Game-membership vitals (middle column): the games I'm on, my regular/
  // occasional default per game, and whether I captain its area.
  const rosterRows = await db.select({ gameId: gameRoster.gameId, defaultStatus: gameRoster.defaultStatus })
    .from(gameRoster).where(eq(gameRoster.userId, uid));
  const defaultByGame = new Map(rosterRows.map((r) => [r.gameId, r.defaultStatus]));
  const ids = rosterRows.map((r) => r.gameId);
  const myGames = ids.length
    ? await db.select({ id: games.id, placeText: games.placeText, city: areas.displayCity, areaId: games.areaId })
        .from(games).innerJoin(areas, eq(areas.id, games.areaId))
        .where(and(inArray(games.id, ids), inArray(games.status, ["active", "paused"])))
    : [];
  const capRows = await db.select({ areaId: areaCaptains.areaId }).from(areaCaptains).where(eq(areaCaptains.userId, uid));
  const captainAreas = new Set(capRows.map((r) => r.areaId));
  const vitals = myGames.map((g) => ({
    id: g.id,
    name: g.placeText.split(" — ")[0],
    city: g.city,
    regular: defaultByGame.get(g.id) === "in",
    captain: captainAreas.has(g.areaId),
  }));

  return (
    <main className="reg account">
      <Link href="/play" className="back">&larr; find a game</Link>
      <h1 className="reg-h">your account</h1>
      <ChangeEmail email={me.email} verified={me.emailVerified != null} canChange={me.passwordHash != null} />

      <AccountForm>
      <div className="account-grid">
        {/* LEFT — supporting the project */}
        <section className="account-col">
          <h2 className="account-col-h">supporting the project</h2>
          <div className={`acct-membership ${supporting ? "acct-membership--supporter" : "acct-membership--free"}`}>
            <span className="acct-membership-label">membership</span>
            <span className="acct-membership-level">{supporting ? "monthly supporter 💚" : "free"}</span>
          </div>
          {supporting ? (
            <>
              <p className="reg-hint">
                thank you for chipping in. your support keeps the servers on - and it&apos;s what lets
                people like you find games in brand-new areas.
              </p>
              {me.stripeSubscriptionId ? (
                <button type="submit" formAction={openBillingPortal} formNoValidate className="btn-green acct-support-cta">
                  manage subscription
                </button>
              ) : (
                <button type="submit" formAction={updateDonationPref} formNoValidate
                  name="donation_status" value="unset" className="game-leave">
                  no longer donating? reset this
                </button>
              )}
            </>
          ) : (
            <>
              <p className="reg-hint">
                free and pay-what-you-can. a <strong>$5/month</strong> donation keeps the servers on and
                helps more local games get off the ground - an ask, not a gate.
              </p>
              <Link href={skin.donate.url} className="btn-green acct-support-cta">support the project</Link>
              <label className="donate-opt">
                <input type="checkbox" name="remind" defaultChecked={me.donationStatus !== "declined"} />
                <span>remind me to make a small monthly donation once I find a game</span>
              </label>
            </>
          )}
        </section>

        {/* MIDDLE — you: display name + game-membership vitals */}
        <section className="account-col">
          <h2 className="account-col-h">you</h2>
          <div className="reg-form">
            <label>
              display name
              <input type="text" name="displayName" placeholder="first name or nickname"
                defaultValue={me.displayName ?? ""} autoComplete="given-name" />
            </label>
          </div>
          <div className="acct-vitals">
            <p className="reg-section">your games</p>
            {vitals.length === 0 ? (
              <p className="reg-hint">you haven&apos;t joined a game yet. <Link href="/play">find one &rarr;</Link></p>
            ) : (
              <ul className="acct-vitals-list">
                {vitals.map((g) => (
                  <li key={g.id}>
                    <span>{g.name}{g.city ? <span className="game-muted"> · {g.city}</span> : null}</span>
                    <span className="game-muted">
                      {g.regular ? "regular" : "occasional"}{g.captain ? " · captain" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/my-games" className="acct-vitals-link">manage in my games &rarr;</Link>
          </div>
        </section>

        {/* RIGHT — location */}
        <section className="account-col">
          <h2 className="account-col-h">location</h2>
          <div className="reg-form">
            <label>
              zip code
              <input type="text" name="zip" placeholder="52241" inputMode="numeric"
                autoComplete="postal-code" pattern="[0-9]{5}" required defaultValue={me.zip ?? ""} />
            </label>
            <p className="reg-section">your address <span className="reg-optional">(optional - sharpens distance to games)</span></p>
            <label>
              street address
              <input type="text" name="address_line1" placeholder="123 Main St"
                autoComplete="address-line1" defaultValue={me.addressLine1 ?? ""} />
            </label>
            <label>
              apt / suite / unit
              <input type="text" name="address_line2" placeholder="Apt 4"
                autoComplete="address-line2" defaultValue={me.addressLine2 ?? ""} />
            </label>
            <div className="reg-row">
              <label>
                city
                <input type="text" name="city" placeholder="Coralville"
                  defaultValue={me.city ?? ""} autoComplete="address-level2" />
              </label>
              <label className="reg-state">
                state
                <input type="text" name="state" placeholder="IA" maxLength={20}
                  defaultValue={me.state ?? ""} autoComplete="address-level1" />
              </label>
            </div>
            <label>
              how far will you travel? (miles)
              <input type="number" name="max_travel_miles" min="1" max="100" step="1"
                defaultValue={travelMiles} inputMode="numeric" />
            </label>
            <label className="donate-opt">
              <input type="checkbox" name="email_opt_in" defaultChecked={me.emailOptIn ?? true} />
              email me when a game is forming or running near me
            </label>
            <p className="reg-hint">
              your address and travel distance are only used to measure how far games
              are from you - never shown to anyone. <Link href="/privacy">privacy</Link>.
            </p>
          </div>
        </section>
      </div>
      </AccountForm>
    </main>
  );
}
