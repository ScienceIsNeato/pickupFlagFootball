"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { registerWithPassword } from "@/lib/auth/register";
import { GoogleButton } from "./GoogleButton";
import { str } from "@/lib/forms";

/** The registration window — the ONLY place an account is created. An anonymous
 *  visitor provides identity (email + username + password, or Google) AND a
 *  location in one step; the server creates the account, area, and interest
 *  signal atomically (createMember). A location is mandatory: it *is* the
 *  interest signal, so there's no such thing as a registered user without one. */
export function RegisterInterestForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Honor the intended destination from a gated flow (e.g. /?signin=1&next=/my-games
  // → "create an account" → here). Only same-origin relative paths.
  const [dest, setDest] = useState("/play");
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n && /^\/(?![/\\])/.test(n)) setDest(n);
  }, []);

  /** Read + validate the location fields for either signup path. null ⇒ no valid ZIP.
   *  Stable identity so GoogleButton's GIS init effect doesn't re-run on each render. */
  const readLocation = useCallback((): { zip: string; line1: string; line2: string; city: string; state: string } | null => {
    const form = formRef.current;
    if (!form) return null;
    const fd = new FormData(form);
    const zip = str(fd.get("zip"));
    if (!/^\d{5}$/.test(zip)) return null;
    return {
      zip, line1: str(fd.get("address_line1")), line2: str(fd.get("address_line2")),
      city: str(fd.get("city")), state: str(fd.get("state")),
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const fd = new FormData(e.currentTarget);
    const email = str(fd.get("email"));
    const username = str(fd.get("username"));
    const password = str(fd.get("password"));
    const loc = readLocation();
    if (!loc) { setError("enter a valid 5-digit ZIP code"); setBusy(false); return; }
    try {
      // Account + location + interest created atomically server-side.
      const reg = await registerWithPassword({ email, password, name: username, ...loc });
      if (!reg.ok) { setError(reg.error); setBusy(false); return; }
      const res = await signIn("password", { email, password, redirect: false });
      if (!res?.ok) { setError("account created, but sign-in failed — try logging in"); setBusy(false); return; }
      window.location.href = dest;
    } catch { setError("something went wrong — please try again"); setBusy(false); }
  }

  return (
    <form ref={formRef} className="reg-form" onSubmit={submit}>
      <div className="auth-google">
        {/* Signup mode: requires a ZIP before completing Google, then createMember. */}
        <GoogleButton dest={dest} mode="signup" getLocation={readLocation} onError={setError} />
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
