import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashToken } from "@/lib/auth/tokens";

export const metadata = { title: "confirm your email — MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * Public confirm-email landing. The link from the verification email carries the
 * single-use token; we stamp email_verified and clear the token in one atomic
 * update (so the link can't be reused). No session required — people click this
 * straight from their inbox.
 */
export default async function VerifyEmailPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  let ok = false;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const [u] = await db.update(users)
      .set({ emailVerified: new Date(), verificationToken: null })
      .where(eq(users.verificationToken, hashToken(token)))
      .returning({ id: users.id });
    ok = !!u;
  }

  // Confirmed → straight to the map (find a game). If they're not signed in on
  // this device, /play sends them through sign-in first.
  if (ok) redirect("/play");

  return (
    <main className="prose">
      <h1>this link didn&apos;t work</h1>
      <p>
        it may have already been used, or it&apos;s not valid. if your email is still
        unconfirmed, open your <Link href="/account">account</Link> and resend the
        confirmation.
      </p>
    </main>
  );
}
