import Link from "next/link";
import { Ball } from "@/components/Ball";
import { AccountMenu } from "@/components/AccountMenu";
import { skin } from "@/lib/skin";
import { auth } from "@/lib/auth";
import { hasActiveInterest } from "@/lib/db/interest";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { UnverifiedBanner } from "@/components/UnverifiedBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const showMine = !!session?.user?.id && (await hasActiveInterest(session.user.id));
  let unverified = false;
  if (session?.user?.id) {
    const [u] = await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, session.user.id)).limit(1);
    unverified = !!u && !u.v; // a real account that hasn't confirmed its email
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
            {showMine && <Link href="/my-games">my games</Link>}
            <Link href="/account">account</Link>
          </nav>
          <AccountMenu />
        </div>
      </header>

      <div className="app-frost" aria-hidden />
      {unverified && <UnverifiedBanner />}
      <div className="app-body">{children}</div>

      <footer className="app-foot">
        <span>{skin.brandName}</span>
        <span className="app-foot-sep">·</span>
        <Link href="/faq">faq</Link>
        <Link href="/privacy">privacy</Link>
        <a href={skin.footer.githubUrl} target="_blank" rel="noopener noreferrer">github</a>
      </footer>
    </>
  );
}
