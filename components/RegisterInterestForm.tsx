"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { registerWithPassword } from "@/lib/auth/register";
import { saveLocationAndInterest } from "@/app/(app)/show-interest/actions";
import { GoogleButton } from "./GoogleButton";
import { str } from "@/lib/forms";

/** The registration window: an anonymous visitor creates an account (email +
 *  username + password, or Google) AND records their location/interest in one
 *  step. Google is a one-tap alternative — it lands the user back here logged
 *  in, where the location-only form takes over. */
export function RegisterInterestForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const fd = new FormData(e.currentTarget);
    const email = str(fd.get("email"));
    const username = str(fd.get("username"));
    const password = str(fd.get("password"));
    try {
      const reg = await registerWithPassword({ email, password, name: username });
      if (!reg.ok) { setError(reg.error); setBusy(false); return; }
      const res = await signIn("password", { email, password, redirect: false });
      if (!res?.ok) { setError("account created, but sign-in failed — try logging in"); setBusy(false); return; }
      const loc = await saveLocationAndInterest(fd);
      if (!loc.ok) { setError(loc.error); setBusy(false); return; }
      window.location.href = "/play";
    } catch { setError("something went wrong — please try again"); setBusy(false); }
  }

  return (
    <form className="reg-form" onSubmit={submit}>
      <div className="auth-google">
        <GoogleButton dest="/show-interest" onError={setError} />
      </div>
      <div className="auth-or"><span>or</span></div>

      {error && <div className="auth-error">{error}</div>}

      <label>
        email
        <input type="email" name="email" placeholder="you@email.com" autoComplete="email" required />
      </label>
      <label>
        username
        <input type="text" name="username" placeholder="captain butterfingers" autoComplete="nickname" required />
      </label>
      <label>
        password
        <input type="password" name="password" placeholder="at least 8 characters"
          autoComplete="new-password" minLength={8} required />
      </label>

      <p className="reg-section">where you play</p>
      <label>
        zip code
        <input type="text" name="zip" placeholder="52241" inputMode="numeric"
          autoComplete="postal-code" pattern="[0-9]{5}" required />
      </label>
      <p className="reg-section">your address <span className="reg-optional">(optional — sharpens distance to games)</span></p>
      <label>
        street address
        <input type="text" name="address_line1" placeholder="1806 Brown Deer Trail" autoComplete="address-line1" />
      </label>
      <label>
        apt / suite / unit
        <input type="text" name="address_line2" placeholder="Apt 4" autoComplete="address-line2" />
      </label>
      <div className="reg-row">
        <label>
          city
          <input type="text" name="city" placeholder="Coralville" autoComplete="address-level2" />
        </label>
        <label className="reg-state">
          state
          <input type="text" name="state" placeholder="IA" autoComplete="address-level1" maxLength={20} />
        </label>
      </div>
      <p className="reg-hint">
        we only use your address to measure how far games are from you. we never
        show it to anyone or sell it — see our <Link href="/privacy">privacy page</Link>.
      </p>
      <button type="submit" className="btn-green" disabled={busy}>
        {busy ? "…" : "count me in"}
      </button>
      <p className="reg-note">
        already have an account? <Link href="/?signin=1&next=/show-interest">log in</Link>
      </p>
    </form>
  );
}
