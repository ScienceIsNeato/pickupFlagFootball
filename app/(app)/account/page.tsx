import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, gameRoster, games, areas, areaCaptains } from "@/lib/db/schema";
import { kmToMiles } from "@/lib/geo";
import { skin } from "@/lib/skin";
import { UsernameForm } from "@/components/UsernameForm";
import { LocationForm } from "@/components/LocationForm";
import { updateDonationPref } from "./actions";
import { openBillingPortal } from "@/app/(marketing)/donate/actions";

export const metadata = { title: "Account — MIME-FF" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/account");
  const uid = session.user.id;

  const [u] = await db
    .select({
      displayName: users.displayName,
      addressLine1: users.addressLine1, addressLine2: users.addressLine2,
      city: users.city, state: users.state, zip: users.zip,
      maxTravelKm: users.maxTravelKm,
      donationStatus: users.donationStatus,
      stripeSubscriptionId: users.stripeSubscriptionId,
    })
    .from(users).where(eq(users.id, uid)).limit(1);
  const me = u ?? {
    displayName: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", maxTravelKm: 24.14,
    donationStatus: "unset" as const, stripeSubscriptionId: null,
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
      <p className="reg-blurb">signed in as <strong>{session.user.email}</strong>.</p>

      <div className="account-grid">
        {/* LEFT — supporting the project */}
        <section className="account-col">
          <h2 className="account-col-h">supporting the project</h2>
          {supporting ? (
            <div className="acct-support-on">
              <span className="acct-support-badge">supporter 💚</span>
              <p className="reg-hint">
                thank you for chipping in. your support keeps the servers on — and it&apos;s what lets
                people like you find games in brand-new areas.
              </p>
              {me.stripeSubscriptionId ? (
                <form action={openBillingPortal}>
                  <button type="submit" className="btn-green">manage subscription</button>
                </form>
              ) : (
                <form action={updateDonationPref}>
                  <input type="hidden" name="donation_status" value="unset" />
                  <button type="submit" className="game-leave">no longer donating? reset this</button>
                </form>
              )}
            </div>
          ) : (
            <>
              <p className="reg-hint">
                free and pay-what-you-can. a <strong>$5/month</strong> donation keeps the servers on and
                helps more local games get off the ground — an ask, not a gate.
              </p>
              <Link href={skin.donate.url} className="btn-green acct-support-cta">support the project</Link>
              <form className="reg-form" action={updateDonationPref}>
                <label className="donate-opt">
                  <input type="radio" name="donation_status" value="unset" defaultChecked={me.donationStatus !== "declined"} />
                  <span>remind me later</span>
                </label>
                <label className="donate-opt">
                  <input type="radio" name="donation_status" value="declined" defaultChecked={me.donationStatus === "declined"} />
                  <span>i&apos;d rather not donate — stop asking</span>
                </label>
                <button type="submit" className="btn-green">save preference</button>
              </form>
            </>
          )}
        </section>

        {/* MIDDLE — you: username + game-membership vitals */}
        <section className="account-col">
          <h2 className="account-col-h">you</h2>
          <UsernameForm displayName={me.displayName ?? ""} />
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
          <LocationForm initial={{
            zip: me.zip ?? "",
            addressLine1: me.addressLine1 ?? "",
            addressLine2: me.addressLine2 ?? "",
            city: me.city ?? "",
            state: me.state ?? "",
            travelMiles,
          }} />
        </section>
      </div>
    </main>
  );
}
