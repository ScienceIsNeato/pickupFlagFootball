import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

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
      .where(eq(users.verificationToken, token))
      .returning({ id: users.id });
    ok = !!u;
  }

  return (
    <main className="prose">
      {ok ? (
        <>
          <h1>email confirmed ✓</h1>
          <p>you&apos;re all set — you can now join and propose games near you.</p>
          <p><Link href="/play">find a game →</Link></p>
        </>
      ) : (
        <>
          <h1>this link didn&apos;t work</h1>
          <p>
            it may have already been used, or it&apos;s not valid. if your email is still
            unconfirmed, open your <Link href="/account">account</Link> and resend the
            confirmation.
          </p>
        </>
      )}
    </main>
  );
}
