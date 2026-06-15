import Link from "next/link";
import { Ball } from "@/components/Ball";
import { auth, signOut } from "@/lib/auth";
import { skin } from "@/lib/skin";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <>
      <header className="nav">
        <Link href="/dashboard" className="brand">
          <Ball />
          {skin.brandName}
        </Link>
        <nav>
          <Link href="/dashboard">dashboard</Link>
          <Link href="/account">account</Link>
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
              style={{ display: "inline" }}
            >
              <button
                type="submit"
                style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", marginLeft: 18, fontSize: 14 }}
              >
                sign out
              </button>
            </form>
          ) : null}
        </nav>
      </header>
      {children}
    </>
  );
}
