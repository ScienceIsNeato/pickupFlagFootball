"use client";

import { useState } from "react";
import { completePasswordReset } from "@/lib/auth/passwordReset";

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await completePasswordReset(token, password);
    if (!r.ok) { setError(r.error); setBusy(false); return; }
    // Password set — bounce to sign-in (the success banner is keyed off ?reset=1).
    window.location.href = "/?signin=1&reset=1";
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {error && <div className="auth-error">{error}</div>}
      <label>new password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="at least 8 characters" autoComplete="new-password" minLength={8} required />
      </label>
      <button type="submit" className="btn-green" disabled={busy}>
        {busy ? "…" : "set new password"}
      </button>
    </form>
  );
}
