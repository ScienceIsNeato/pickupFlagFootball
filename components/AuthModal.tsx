"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { registerWithPassword } from "@/lib/auth/register";

type GsiButtonConfig = { theme?: string; size?: string; width?: number; text?: string; shape?: string };
type Gsi = {
  accounts: { id: {
    initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
    renderButton: (el: HTMLElement, o: GsiButtonConfig) => void;
  } };
};
declare global { interface Window { google?: Gsi } }

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gsi load failed"));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

export function AuthModal({ onClose, callbackUrl }: { onClose: () => void; callbackUrl?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleOff, setGoogleOff] = useState(false);
  const gbtn = useRef<HTMLDivElement>(null);

  // only same-origin relative paths — never an absolute/protocol-relative URL
  const safe = callbackUrl && /^\/(?![/\\])/.test(callbackUrl) ? callbackUrl : null;
  const dest = safe || "/dashboard";

  // Google Identity Services popup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await (await fetch("/api/google-config")).json();
        if (!cfg.clientId) { setGoogleOff(true); return; }
        await loadGsi();
        if (cancelled || !window.google || !gbtn.current) return;
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          callback: async (resp) => {
            setBusy(true); setError("");
            const res = await signIn("google-onetap", { credential: resp.credential, redirect: false });
            if (res?.ok) window.location.href = dest;
            else { setError("google sign-in failed"); setBusy(false); }
          },
        });
        window.google.accounts.id.renderButton(gbtn.current, {
          theme: "filled_black", size: "large", width: 300, text: "continue_with", shape: "pill",
        });
      } catch { setGoogleOff(true); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {googleOff
            ? <p className="auth-note">google sign-in isn&apos;t configured yet — use email below.</p>
            : <div ref={gbtn} />}
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
