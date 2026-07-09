import Link from "next/link";
import { Ball } from "@/components/Ball";
import { AccountMenu } from "@/components/AccountMenu";
import { skin } from "@/lib/skin";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, gameRoster, games } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { UnverifiedBanner } from "@/components/UnverifiedBanner";
import { DonationReminderBanner } from "@/components/DonationReminderBanner";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const loggedIn = !!session?.user?.id;
  let unverified = false;
  let remindDonate = false;
  if (loggedIn) {
    const uid = session!.user!.id!;
    const [u] = await db.select({ v: users.emailVerified, ds: users.donationStatus })
      .from(users).where(eq(users.id, uid)).limit(1);
    unverified = !!u && !u.v; // a real account that hasn't confirmed its email
    // Support nudge: reminder still on AND they're actually on a weekly game
    // ("once I find a game"). Skip while unverified — that banner takes priority,
    // and an unconfirmed account can't be on a roster anyway.
    if (u && u.ds === "unset" && !unverified) {
      const mine = await db.select({ g: gameRoster.gameId })
        .from(gameRoster).innerJoin(games, eq(games.id, gameRoster.gameId))
        .where(and(eq(gameRoster.userId, uid), inArray(games.status, ["active", "paused"])))
        .limit(1);
      remindDonate = mine.length > 0;
    }
  }
  return (
    <>
      <header className="nav nav-float">
        <Link href="/" className="brand">
          <Ball />
          {skin.brandName}
        </Link>
        <div className="nav-right">
          <nav>
            <Link href="/play">find a game</Link>
            {loggedIn && <Link href="/my-games">my games</Link>}
            <Link href="/account">account</Link>
          </nav>
          <AccountMenu />
        </div>
      </header>

      <div className="app-frost" aria-hidden />
      {unverified && <UnverifiedBanner />}
      {remindDonate && <DonationReminderBanner />}
      <div className="app-body">{children}</div>

      <footer className="app-foot">
        <span>{skin.brandName}</span>
        <span className="app-foot-sep">·</span>
        <Link href="/faq">faq</Link>
        <Link href="/privacy">privacy</Link>
        <Link href="/terms">terms</Link>
        <a href={`mailto:${SUPPORT_EMAIL}`}>contact</a>
        <a href={skin.footer.githubUrl} target="_blank" rel="noopener noreferrer">github</a>
      </footer>
    </>
  );
}
