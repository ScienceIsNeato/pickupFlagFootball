"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { registerWithPassword } from "@/lib/auth/register";
import { GoogleButton } from "./GoogleButton";
import { PasswordInput } from "@/components/PasswordInput";
import { AddressFinder, type FoundAddress } from "@/components/AddressFinder";
import { str } from "@/lib/forms";

/** The registration window — the ONLY place an account is created. An anonymous
 *  visitor provides identity (email + username + password, or Google) AND a
 *  location in one step; the server creates the account, area, and interest
 *  signal atomically (createMember). A location is mandatory: it *is* the
 *  interest signal, so there's no such thing as a registered user without one.
 *
 *  Location comes from the AddressFinder ONLY — a picked, geocoder-validated
 *  result (ZIPs resolve locally; streets via Nominatim). Free-text garbage
 *  can't reach the server, and validation errors are our own visible messages:
 *  iOS Safari silently swallows native required/pattern bubbles, which made
 *  bad submits look like the form doing nothing. */
export function RegisterInterestForm() {
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<{ email?: string; username?: string; password?: string; addr?: string }>({});
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState<FoundAddress | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) { errRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); errRef.current?.focus({ preventScroll: true }); }
  }, [error]);
  // Honor the intended destination from a gated flow (e.g. /?signin=1&next=/my-games
  // → "create an account" → here). Only same-origin relative paths.
  const [dest, setDest] = useState("/play");
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n && /^\/(?![/\\])/.test(n)) setDest(n);
  }, []);

  // The picked address rides a ref (not just state) so GoogleButton's stable
  // getLocation callback always reads the current pick.
  const addrRef = useRef<FoundAddress | null>(null);
  addrRef.current = addr;

  /** Location for either signup path — the AddressFinder's pick or nothing. */
  const readLocation = useCallback((): { zip: string; line1: string; line2: string; city: string; state: string } | null => {
    const a = addrRef.current;
    if (!a) return null;
    const fd = formRef.current ? new FormData(formRef.current) : null;
    return {
      zip: a.zip, line1: a.line1, line2: str(fd?.get("address_line2") ?? ""),
      city: a.city, state: a.state,
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const fd = new FormData(e.currentTarget);
    const email = str(fd.get("email"));
    const username = str(fd.get("username"));
    const password = str(fd.get("password"));
    // Our own validation with visible messages (noValidate on the form).
    const fe: typeof fieldErrs = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fe.email = "enter a real email address";
    if (!username) fe.username = "pick a display name";
    if (password.length < 8) fe.password = "at least 8 characters";
    const loc = readLocation();
    if (!loc) fe.addr = "find and pick your ZIP or address above";
    setFieldErrs(fe);
    if (Object.keys(fe).length) {
      setError("almost - fix the highlighted fields");
      setBusy(false);
      return;
    }
    try {
      // Account + location + interest created atomically server-side.
      const reg = await registerWithPassword({ email, password, name: username, ...loc! });
      if (!reg.ok) { setError(reg.error); setBusy(false); return; }
      const res = await signIn("password", { email, password, redirect: false });
      // `ok` is HTTP success, not auth success — check `error` too (see AuthModal).
      if (res?.error || !res?.ok) { setError("account created, but sign-in failed - try logging in"); setBusy(false); return; }
      window.location.href = dest;
    } catch { setError("something went wrong - please try again"); setBusy(false); }
  }

  return (
    <form ref={formRef} className="reg-form" onSubmit={submit} noValidate>
      {/* Location first: it's the one thing BOTH signup paths need (audit M13) —
          with it above the Google button, google + a picked address really is
          the whole signup. */}
      <label>
        where you play <span className="reg-optional">(ZIP is enough - a street address sharpens distances)</span>
        <AddressFinder value={addr} onSelect={(a) => { setAddr(a); if (a) setFieldErrs((f) => ({ ...f, addr: undefined })); }} />
        {fieldErrs.addr && <span className="field-err">{fieldErrs.addr}</span>}
      </label>
      <div className="auth-google">
        {/* Signup mode: requires a picked address before completing Google. */}
        <GoogleButton dest={dest} mode="signup" getLocation={readLocation}
          onError={(m) => setError(m === "enter your zip code first, then continue with google"
            ? "pick your ZIP or address first, then continue with google" : m)} />
      </div>
      <p className="reg-hint">
        signing up - with google or the form below - confirms you&apos;re 18 or
        older and agree to the <Link href="/terms">terms of service</Link> and{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
      <div className="auth-or"><span>or</span></div>

      {/* On a 375px screen this error can sit a full viewport above the submit
          button the user just tapped - scroll it into view and announce it, or
          the form reads as silently broken (gap-review major). */}
      {error && (
        <div className="auth-error" role="alert" ref={errRef} tabIndex={-1}>
          {error}
          {/already exists|already registered/i.test(error) && (
            <> <Link href="/?signin=1&next=/play">log in instead</Link></>
          )}
        </div>
      )}

      <label>
        email
        <input type="email" name="email" placeholder="you@email.com" autoComplete="email" />
        {fieldErrs.email && <span className="field-err">{fieldErrs.email}</span>}
      </label>
      <label>
        username
        <input type="text" name="username" placeholder="captain butterfingers" autoComplete="nickname" />
        {fieldErrs.username && <span className="field-err">{fieldErrs.username}</span>}
      </label>
      <label>
        password
        <PasswordInput name="password" placeholder="at least 8 characters" autoComplete="new-password" />
        {fieldErrs.password && <span className="field-err">{fieldErrs.password}</span>}
      </label>
      <label>
        apt / suite / unit <span className="reg-optional">(optional)</span>
        <input type="text" name="address_line2" placeholder="Apt 4" autoComplete="address-line2" />
      </label>
      <p className="reg-hint">
        we only use your address to measure how far games are from you. we never
        show it to anyone or sell it - see our <Link href="/privacy">privacy page</Link>.
      </p>
      <p className="reg-hint">
        creating an account - here or with google above - confirms you&apos;re 18
        or older and that you agree to the <Link href="/terms">terms of service</Link>,
        including its assumption of risk and release of liability, and the{" "}
        <Link href="/privacy">privacy policy</Link>.
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
