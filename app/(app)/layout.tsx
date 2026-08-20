import Link from "next/link";
import { Ball } from "@/components/Ball";
import { ChatUnreadDot } from "@/components/ChatUnreadDot";
import { AccountMenu } from "@/components/AccountMenu";
import { skin } from "@/lib/skin";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, gameRoster, games, gameAttendance, gameOccurrences } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { UnverifiedBanner } from "@/components/UnverifiedBanner";
import { DonationReminderBanner } from "@/components/DonationReminderBanner";
import { AppTabBar } from "@/components/AppTabBar";
import { RegisterSW } from "@/components/RegisterSW";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@pickupflagfootball.com";

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
      // Played at least 3 weeks, not merely rostered. Joining is a click; showing
      // up three times is the point at which someone actually knows whether this
      // thing is worth money to them. Asking on day one reads as a toll booth.
      const played = await db.select({ n: sql<number>`count(*)::int` })
        .from(gameAttendance)
        .innerJoin(gameOccurrences, and(
          eq(gameOccurrences.gameId, gameAttendance.gameId),
          eq(gameOccurrences.occurrenceDate, gameAttendance.occurrenceDate),
        ))
        .where(and(
          eq(gameAttendance.userId, uid),
          eq(gameAttendance.status, "in"),
          eq(gameOccurrences.status, "played"),
        ));
      remindDonate = mine.length > 0 && (played[0]?.n ?? 0) >= 3;
    }
  }
  return (
    <>
      <header className="nav nav-float">
        {/* audit M34: for a signed-in user the brand anchors the APP (the map),
            not the marketing splash - the splash is for people we haven't met. */}
        <Link href={loggedIn ? "/play" : "/"} className="brand">
          <Ball />
          {skin.brandName}
        </Link>
        <div className="nav-right">
          <nav>
            <span className="nav-with-dot">
              <Link href="/play">find a game</Link>
              {loggedIn && <ChatUnreadDot />}
            </span>
            {loggedIn && <Link href="/my-games">my games</Link>}
            <Link href="/account">account</Link>
          </nav>
          <AccountMenu />
        </div>
      </header>

      <RegisterSW />
      <div className="app-frost" aria-hidden />
      {unverified && <UnverifiedBanner />}
      {remindDonate && <DonationReminderBanner />}
      <div className="app-body">{children}</div>

      {/* Desktop keeps the legal-links footer; phones replace it with the tab
          bar (A1) and reach these links via /account instead — a permanent bar
          of meta links was the audit's inverted-navigation finding (M2/M32). */}
      <footer className="app-foot">
        <span>{skin.brandName}</span>
        <span className="app-foot-sep">·</span>
        <Link href="/faq">faq</Link>
        <Link href="/privacy">privacy</Link>
        <Link href="/terms">terms</Link>
        <a href={`mailto:${SUPPORT_EMAIL}`}>contact</a>
        <a href={skin.footer.githubUrl} target="_blank" rel="noopener noreferrer">github</a>
      </footer>
      <AppTabBar loggedIn={loggedIn} />
    </>
  );
}
