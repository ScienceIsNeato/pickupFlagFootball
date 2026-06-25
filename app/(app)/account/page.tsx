import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { kmToMiles } from "@/lib/geo";
import { skin } from "@/lib/skin";
import { AccountForm } from "@/components/AccountForm";
import { updateDonationPref } from "./actions";
import { openBillingPortal } from "@/app/(marketing)/donate/actions";

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
      stripeCustomerId: users.stripeCustomerId,
      stripeSubscriptionId: users.stripeSubscriptionId,
    })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  const u = rows[0] ?? {
    displayName: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", maxTravelKm: 24.14,
    donationStatus: "unset" as const, stripeCustomerId: null, stripeSubscriptionId: null,
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
      <AccountForm initial={{
        displayName: u.displayName ?? "",
        zip: u.zip ?? "",
        addressLine1: u.addressLine1 ?? "",
        addressLine2: u.addressLine2 ?? "",
        city: u.city ?? "",
        state: u.state ?? "",
        travelMiles,
      }} />

      {u.donationStatus === "subscribed" ? (
        u.stripeSubscriptionId ? (
          // Active Stripe subscriber → manage via the billing portal.
          <form className="reg-form donate-pref" action={openBillingPortal}>
            <p className="reg-section">supporting the project</p>
            <p className="reg-hint">you&apos;re chipping in $5/month 💚 — thank you. manage or cancel anytime.</p>
            <button type="submit" className="btn-green">manage subscription</button>
          </form>
        ) : (
          // Legacy honor-system subscriber (self-declared, no Stripe sub): thanks +
          // an explicit reset, so a stray save can't silently downgrade them.
          <form className="reg-form donate-pref" action={updateDonationPref}>
            <p className="reg-section">supporting the project</p>
            <p className="reg-hint">you&apos;ve told us you&apos;re chipping in 💚 — thank you.</p>
            <input type="hidden" name="donation_status" value="unset" />
            <button type="submit" className="game-leave">no longer donating? reset this</button>
          </form>
        )
      ) : (
        // Not subscribed: the reminder preference (subscribing is via /donate →
        // Stripe, which sets "subscribed" itself — so it's not a manual option).
        <form className="reg-form donate-pref" action={updateDonationPref}>
          <p className="reg-section">supporting the project</p>
          <p className="reg-hint">
            this app is free and pay-what-you-can. a <Link href={skin.donate.url}>$5/month donation</Link>{" "}
            keeps the servers on — an ask, not a gate. tell us where you stand so we only remind you if you want.
          </p>
          <label className="donate-opt">
            <input type="radio" name="donation_status" value="unset" defaultChecked={u.donationStatus !== "declined"} />
            <span>remind me later</span>
          </label>
          <label className="donate-opt">
            <input type="radio" name="donation_status" value="declined" defaultChecked={u.donationStatus === "declined"} />
            <span>i&apos;d rather not donate — stop asking</span>
          </label>
          <button type="submit" className="btn-green">save preference</button>
        </form>
      )}
    </main>
  );
}
