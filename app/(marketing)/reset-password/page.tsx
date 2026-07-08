import Link from "next/link";
import { resetTokenValid } from "@/lib/auth/passwordReset";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "set a new password - MIME-FF" };
export const dynamic = "force-dynamic";

/**
 * Landing for the password-reset email link. The GET only validates the token
 * (read-only); the new password is set by the form's server action. An
 * invalid/expired token gets a clear message and a path to request a fresh one.
 */
export default async function ResetPasswordPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valid = token ? await resetTokenValid(token) : false;

  if (!valid) {
    return (
      <main className="prose">
        <h1>this reset link is invalid or expired</h1>
        <p>
          reset links are good for one hour. <Link href="/forgot-password">request a new one</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="prose">
      <h1>set a new password</h1>
      <p>choose a new password for your account.</p>
      <ResetForm token={token!} />
    </main>
  );
}
