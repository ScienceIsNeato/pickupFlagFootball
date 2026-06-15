import Link from "next/link";
import { Ball } from "./Ball";
import { skin } from "@/lib/skin";

export function SiteNav() {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <Ball />
        {skin.brandName}
      </Link>
      <nav>
        <Link href="/#how">how it works</Link>
        <Link href="/gear">gear</Link>
        <Link href="/faq">faq</Link>
      </nav>
    </header>
  );
}
