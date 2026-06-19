import Link from "next/link";
import { Ball } from "./Ball";
import { AccountMenu } from "./AccountMenu";
import { skin } from "@/lib/skin";

export function SiteNav() {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <Ball />
        {skin.brandName}
      </Link>
      <div className="nav-right">
        <nav>
          <Link href="/gear">gear</Link>
          <Link href="/faq">faq</Link>
        </nav>
        <AccountMenu />
      </div>
    </header>
  );
}
