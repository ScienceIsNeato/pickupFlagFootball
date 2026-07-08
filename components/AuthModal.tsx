"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { GoogleButton } from "./GoogleButton";
import { useFocusTrap } from "@/lib/useFocusTrap";

/** Sign-IN only. Account creation lives at /show-interest (the one place that
 *  collects a location, so every account has an interest signal). This modal
 *  logs existing users in via password or Google. */
export function AuthModal({ onClose, callbackUrl, notice }: { onClose: () => void; callbackUrl?: string; notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef); // aria-modal alone doesn't trap Tab into the page behind

  // only same-origin relative paths — never an absolute/protocol-relative URL
  const safe = callbackUrl && /^\/(?![/\\])/.test(callbackUrl) ? callbackUrl : null;
  const dest = safe || "/play";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await signIn("password", { email, password, redirect: false });
      // next-auth v5: `ok` is HTTP success (the callback returns 200 even on a
      // bad password), so a truthy `ok` does NOT mean auth succeeded — `error`
      // is the real signal. Navigating on `ok` alone bounced wrong logins to
      // /play → middleware → /?signin=1 (a flash with no error shown).
      // A Google-registered account has no password, so its password login also
      // fails here — point people at the Google button rather than leaving them
      // stuck retyping a password they never set.
      if (res?.error) { setError("wrong email or password — if you signed up with Google, use the Google button above"); setBusy(false); return; }
      if (res?.ok) { window.location.href = dest; return; }
      setError("something went wrong"); setBusy(false);
    } catch { setError("something went wrong"); setBusy(false); }
  }

  return (
    <div className="auth-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={cardRef} className="auth-card" role="dialog" aria-modal="true" aria-label="sign in">
        <button className="auth-close" onClick={onClose} aria-label="close">×</button>
        <h2 className="auth-title">welcome back</h2>
        <p className="auth-sub">sign in to see who&apos;s nearby.</p>

        <div className="auth-google">
          <GoogleButton dest={dest} onError={setError} />
        </div>

        <div className="auth-or"><span>or</span></div>

        {notice && !error && <div className="auth-notice">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          <label>email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" required />
          </label>
          <label>password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="your password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="btn-green" disabled={busy}>
            {busy ? "…" : "log in"}
          </button>
        </form>

        <p className="auth-switch">
          <Link className="auth-link" onClick={onClose} href="/forgot-password">forgot your password?</Link>
        </p>

        <p className="auth-switch">
          new here?{" "}
          {/* Close the modal as we go — otherwise it stays mounted on top of the
              /show-interest registration form (esp. when already on that page) and
              looks like nothing happened. */}
          <Link className="auth-link" onClick={onClose} href={`/show-interest?next=${encodeURIComponent(dest)}`}>create an account</Link>
        </p>
      </div>
    </div>
  );
}
