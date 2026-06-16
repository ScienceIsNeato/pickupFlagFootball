import Link from "next/link";
import { Ball } from "@/components/Ball";
import { AccountMenu } from "@/components/AccountMenu";
import { skin } from "@/lib/skin";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="nav">
        <Link href="/dashboard" className="brand">
          <Ball />
          {skin.brandName}
        </Link>
        <div className="nav-right">
          <nav>
            <Link href="/dashboard">dashboard</Link>
            <Link href="/account">account</Link>
          </nav>
          <AccountMenu />
        </div>
      </header>
      {children}
    </>
  );
}
