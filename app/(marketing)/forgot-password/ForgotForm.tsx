"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth/passwordReset";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await requestPasswordReset(email);
    // Always the same outcome regardless of whether the email has an account,
    // so the page can't be used to probe who's registered.
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <main className="prose">
        <h1>check your email</h1>
        <p>
          if an account exists for <strong>{email}</strong>, we just sent a link
          to reset its password. it&apos;s good for one hour.
        </p>
        <p>
          didn&apos;t get it? check spam, or <Link href="/forgot-password">try again</Link>.
          signed up with google?{" "}
          <Link href="/?signin=1">use the google button to sign in</Link> instead.
        </p>
      </main>
    );
  }

  return (
    <main className="prose">
      <h1>reset your password</h1>
      <p>enter your email and we&apos;ll send you a link to set a new password.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com" autoComplete="email" required />
        </label>
        <button type="submit" className="btn-green" disabled={busy}>
          {busy ? "…" : "send reset link"}
        </button>
      </form>
      <p className="auth-switch">
        remembered it? <Link className="auth-link" href="/?signin=1">back to sign in</Link>
      </p>
    </main>
  );
}
