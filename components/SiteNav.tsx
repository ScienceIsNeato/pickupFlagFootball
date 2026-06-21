import Link from "next/link";
import { Ball } from "./Ball";
import { AccountMenu } from "./AccountMenu";
import { HeaderPlayLink } from "./HeaderPlayLink";
import { skin } from "@/lib/skin";
import { auth } from "@/lib/auth";

export async function SiteNav() {
  const session = await auth();
  const loggedIn = !!session?.user?.id;
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <Ball />
        {skin.brandName}
      </Link>
      <div className="nav-right">
        <nav>
          <HeaderPlayLink loggedIn={loggedIn} />
          <Link href="/faq">faq</Link>
        </nav>
        <AccountMenu />
      </div>
    </header>
  );
}
