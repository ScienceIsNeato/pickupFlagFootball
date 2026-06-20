"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { registerWithPassword } from "@/lib/auth/register";
import { GoogleButton } from "./GoogleButton";

export function AuthModal({ onClose, callbackUrl }: { onClose: () => void; callbackUrl?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      if (mode === "register") {
        const r = await registerWithPassword({ email, password, name });
        if (!r.ok) { setError(r.error); setBusy(false); return; }
      }
      const res = await signIn("password", { email, password, redirect: false });
      if (res?.ok) window.location.href = dest;
      else { setError(mode === "login" ? "wrong email or password" : "could not sign in"); setBusy(false); }
    } catch { setError("something went wrong"); setBusy(false); }
  }

  return (
    <div className="auth-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="auth-card" role="dialog" aria-modal="true" aria-label="sign in">
        <button className="auth-close" onClick={onClose} aria-label="close">×</button>
        <h2 className="auth-title">{mode === "login" ? "welcome back" : "join the game"}</h2>
        <p className="auth-sub">sign in to show interest and see who&apos;s nearby.</p>

        <div className="auth-google">
          <GoogleButton dest={dest} onError={setError} />
        </div>

        <div className="auth-or"><span>or</span></div>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <label>name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="first name" autoComplete="name" required />
            </label>
          )}
          <label>email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" required />
          </label>
          <label>password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "login" ? "your password" : "at least 8 characters"}
              autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          </label>
          <button type="submit" className="btn-green" disabled={busy}>
            {busy ? "…" : mode === "login" ? "log in" : "create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "new here?" : "already have an account?"}{" "}
          <button type="button" className="auth-link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "create an account" : "log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
