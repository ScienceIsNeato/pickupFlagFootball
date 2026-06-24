"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { GoogleButton } from "./GoogleButton";
import { useFocusTrap } from "@/lib/useFocusTrap";

/** Sign-IN only. Account creation lives at /show-interest (the one place that
 *  collects a location, so every account has an interest signal). This modal
 *  logs existing users in via password or Google. */
export function AuthModal({ onClose, callbackUrl }: { onClose: () => void; callbackUrl?: string }) {
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
      if (res?.ok) window.location.href = dest;
      else { setError("wrong email or password"); setBusy(false); }
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
          new here?{" "}
          <Link className="auth-link" href={`/show-interest?next=${encodeURIComponent(dest)}`}>create an account</Link>
        </p>
      </div>
    </div>
  );
}
