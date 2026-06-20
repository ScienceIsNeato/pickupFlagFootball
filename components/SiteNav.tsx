import Link from "next/link";
import { Ball } from "./Ball";
import { AccountMenu } from "./AccountMenu";
import { HeaderPlayLink } from "./HeaderPlayLink";
import { skin } from "@/lib/skin";
import { auth } from "@/lib/auth";
import { hasActiveInterest } from "@/lib/db/interest";

export async function SiteNav() {
  const session = await auth();
  const showMine = !!session?.user?.id && (await hasActiveInterest(session.user.id));
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <Ball />
        {skin.brandName}
      </Link>
      <div className="nav-right">
        <nav>
          <HeaderPlayLink showMine={showMine} />
          <Link href="/faq">faq</Link>
        </nav>
        <AccountMenu />
      </div>
    </header>
  );
}
