"use client";

import { useEffect, useRef, useState } from "react";
import { sendInvite } from "@/lib/invite";
import { useFocusTrap } from "@/lib/useFocusTrap";

/** "Invite a friend" modal: emails a branded join link (→ /show-interest) to a
 *  friend. No account is pre-created; the friend registers normally. */
export function InviteFriend({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await sendInvite(email);
      if (!r.ok) { setError(r.error); setBusy(false); return; }
      setSentTo(email.toLowerCase().trim()); setBusy(false);
    } catch {
      setError("something went wrong — please try again"); setBusy(false);
    }
  }

  return (
    <div className="auth-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={cardRef} className="auth-card" role="dialog" aria-modal="true" aria-label="invite a friend">
        <button className="auth-close" onClick={onClose} aria-label="close">×</button>
        {sentTo ? (
          <>
            <h2 className="auth-title">invite sent</h2>
            <p className="auth-sub">
              we emailed a join link to <strong>{sentTo}</strong>. thanks for spreading the word!
            </p>
            <button className="btn-green" onClick={onClose}>done</button>
          </>
        ) : (
          <>
            <h2 className="auth-title">invite a friend</h2>
            <p className="auth-sub">
              know someone who&apos;d play? we&apos;ll email them a link to get on the map near them.
            </p>
            {error && <div className="auth-error">{error}</div>}
            <form className="auth-form" onSubmit={submit}>
              <label>their email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="friend@email.com" autoComplete="off" required />
              </label>
              <button type="submit" className="btn-green" disabled={busy}>
                {busy ? "…" : "send invite"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
