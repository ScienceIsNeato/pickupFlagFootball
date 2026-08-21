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
 *  Location is L3 (see the location-input mockups): a required ZIP confirmed
 *  against the local centroid table the moment 5 digits land, plus an optional
 *  fold-out street address (pick-only autocomplete). Garbage can't proceed and
 *  every failure is a visible message: iOS Safari silently swallows native
 *  required/pattern bubbles, which made bad submits look like nothing. */
export function RegisterInterestForm() {
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<{ email?: string; username?: string; password?: string; zip?: string }>({});
  const [busy, setBusy] = useState(false);
  // L3 location model: a plain required ZIP, confirmed against the local
  // centroid table the moment 5 digits land; a street address is an optional
  // fold-out pick that sharpens distances. A picked street sets the ZIP; a
  // manual ZIP edit that disagrees clears the stale pick.
  const [zip, setZip] = useState("");
  const [zipInfo, setZipInfo] = useState<{ status: "idle" | "checking" | "ok" | "bad"; label?: string; city?: string; state?: string }>({ status: "idle" });
  const [showAddr, setShowAddr] = useState(false);
  const [addr, setAddr] = useState<FoundAddress | null>(null);

  useEffect(() => {
    if (!/^\d{5}$/.test(zip)) { setZipInfo({ status: "idle" }); return; }
    // A street pick already confirmed this ZIP (with its city) — don't let the
    // re-check overwrite the instant confirmation (review: the effect stomped
    // the pick's label with "checking…" and could even flip it to bad).
    if (addrRef.current && addrRef.current.zip === zip) return;
    let alive = true;
    setZipInfo({ status: "checking" });
    (async () => {
      // Soft-fail on ANY infrastructure trouble (thrown fetch, 429, 5xx): only
      // a definitive "the table doesn't know this ZIP" marks it bad. The client
      // check is UX; createMember re-validates server-side, so an unverified
      // "ZIP entered" can never actually register a garbage ZIP.
      try {
        const r = await fetch(`/api/address-search?q=${zip}`);
        if (!alive) return;
        if (!r.ok) { setZipInfo({ status: "ok", label: "ZIP entered" }); return; }
        const d = (await r.json()) as { results: FoundAddress[] };
        const hit = d.results[0];
        if (!hit) { setZipInfo({ status: "bad" }); return; }
        setZipInfo({ status: "ok", label: "ZIP found", city: hit.city, state: hit.state });
        setFieldErrs((f) => ({ ...f, zip: undefined }));
        // Background label upgrade — the ✓ is already showing; this only makes
        // it friendlier ("Coralville, Iowa") and never gates anything.
        try {
          const r2 = await fetch(`/api/address-search?q=${zip}&enrich=1`);
          if (!alive || !r2.ok) return;
          const d2 = (await r2.json()) as { results: FoundAddress[] };
          const h2 = d2.results[0];
          // a street pick may have landed while this was in flight - its label
          // (and city/state) win over the ZIP-derived enrichment
          if (h2?.city) setZipInfo((cur) => cur.status === "ok" && !addrRef.current
            ? { status: "ok", label: `${h2.city}, ${h2.state}`, city: h2.city, state: h2.state } : cur);
        } catch { /* label upgrade only */ }
      } catch {
        if (alive) setZipInfo({ status: "ok", label: "ZIP entered" });
      }
    })();
    return () => { alive = false; };
  }, [zip]);
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

  /** Location for either signup path — a confirmed ZIP, plus the street pick
   *  when one was made. */
  const zipRef = useRef({ zip, ok: zipInfo.status === "ok", city: zipInfo.city ?? "", state: zipInfo.state ?? "" });
  zipRef.current = { zip, ok: zipInfo.status === "ok", city: zipInfo.city ?? "", state: zipInfo.state ?? "" };
  const readLocation = useCallback((): { zip: string; line1: string; line2: string; city: string; state: string } | null => {
    const z = zipRef.current;
    if (!z.ok) return null;
    const a = addrRef.current;
    const fd = formRef.current ? new FormData(formRef.current) : null;
    return {
      zip: z.zip, line1: a?.line1 ?? "", line2: str(fd?.get("address_line2") ?? ""),
      city: a?.city ?? z.city, state: a?.state ?? z.state,
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
    if (password.length < 8) fe.password = "at least 8 characters"; // pragma: allowlist secret — validation copy, not a credential
    const loc = readLocation();
    if (!loc) fe.zip = zipInfo.status === "bad" ? "we don't know that ZIP - double-check it" : "enter your 5-digit ZIP above";
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
      {/* Location first: it's the one thing BOTH signup paths need (audit M13).
          L3: ZIP is the requirement, confirmed on the spot; street is optional. */}
      <label>
        zip code <span className="reg-optional">(where we look for games)</span>
        <input type="text" name="zip" value={zip} inputMode="numeric" autoComplete="postal-code"
          placeholder="52241" maxLength={5}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 5);
            setZip(v);
            if (addr && v !== addr.zip) setAddr(null); // stale street pick
          }} />
        {zipInfo.status === "checking" && <span className="zip-note">checking&hellip;</span>}
        {zipInfo.status === "ok" && <span className="zip-ok" data-testid="zip-ok">&#10003; {zipInfo.label}</span>}
        {zipInfo.status === "bad" && <span className="field-err">we don&apos;t know that ZIP - double-check it</span>}
        {fieldErrs.zip && zipInfo.status !== "bad" && <span className="field-err">{fieldErrs.zip}</span>}
      </label>
      {!showAddr && !addr && (
        <button type="button" className="addr-fold-link" onClick={() => setShowAddr(true)}>
          + add your street address <span className="reg-optional">(sharpens distances)</span>
        </button>
      )}
      {(showAddr || addr) && (
        <div className="addr-fold">
          <label>
            street address <span className="reg-optional">(optional)</span>
            <AddressFinder value={addr} placeholder="start typing your street address"
              onSelect={(a) => {
                setAddr(a);
                if (a) {
                  setZip(a.zip);
                  // the pick already knows its city - confirm instantly, no re-fetch wait
                  setZipInfo({ status: "ok", label: a.city ? `${a.city}, ${a.state}` : "ZIP found", city: a.city, state: a.state });
                  setFieldErrs((f) => ({ ...f, zip: undefined }));
                }
              }} />
          </label>
          <label>
            apt / suite / unit <span className="reg-optional">(optional)</span>
            <input type="text" name="address_line2" placeholder="Apt 4" autoComplete="address-line2" />
          </label>
        </div>
      )}
      <div className="auth-google">
        {/* Signup mode: requires a CONFIRMED ZIP before completing Google —
            the street address is optional garnish (L3). */}
        <GoogleButton dest={dest} mode="signup" getLocation={readLocation}
          onError={(m) => setError(m === "enter your zip code first, then continue with google"
            ? "enter your ZIP first, then continue with google" : m)} />
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
