import Link from "next/link";
import { Ball } from "@/components/Ball";
import { AccountMenu } from "@/components/AccountMenu";
import { skin } from "@/lib/skin";
import { auth } from "@/lib/auth";
import { hasActiveInterest } from "@/lib/db/interest";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const showMine = !!session?.user?.id && (await hasActiveInterest(session.user.id));
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
