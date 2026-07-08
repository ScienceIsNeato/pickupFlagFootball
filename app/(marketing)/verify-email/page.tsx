import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashToken } from "@/lib/auth/tokens";
import { confirmEmail } from "./actions";

export const metadata = { title: "confirm your email - MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * Public confirm-email landing. The email link (a GET) lands here and shows a
 * button; the actual verification happens on POST (see actions.ts) so mail
 * scanners can't consume the single-use token. The GET only READS (looks up
 * whether the token is still live) — a read is scanner-safe. `?done=ok|fail` is
 * the result of the POST. No session required — people click straight from the
 * inbox, often on a different device than they signed up on, so success is a
 * real page with a "find a game" button rather than a redirect into a
 * login-gated route.
 */
export default async function VerifyEmailPage({
  searchParams,
}: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;

  if (done === "ok") {
    return (
      <main className="prose">
        <h1>email confirmed ✓</h1>
        <p>
          you&apos;re all set. head to the map to find a game near you — if
          you&apos;re not signed in on this device, we&apos;ll ask you to log in
          first.
        </p>
        <p><Link href="/play" className="btn-green">find a game</Link></p>
      </main>
    );
  }

  const failed = (
    <main className="prose">
      <h1>this link didn&apos;t work</h1>
      <p>
        it may have already been used, or it&apos;s expired. if your email is
        still unconfirmed, <Link href="/play">sign in</Link> and use the
        <strong> resend</strong> link on the banner at the top of the page.
      </p>
    </main>
  );

  if (done === "fail" || !token || !/^[a-f0-9]{64}$/.test(token)) return failed;

  // Read-only: is this token still live? (No mutation — a scanner hitting the
  // GET can't consume it; only the button's POST does.)
  const [u] = await db.select({ id: users.id }).from(users)
    .where(eq(users.verificationToken, hashToken(token))).limit(1);
  if (!u) return failed;

  return (
    <main className="prose">
      <h1>confirm your email</h1>
      <p>tap below to confirm this is your email and finish setting up your account.</p>
      <form action={confirmEmail}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn-green">confirm my email</button>
      </form>
    </main>
  );
}
