"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { changeEmail } from "@/lib/auth/changeEmail";

/** Self-serve email change on the account page. Swaps the address and sends a
 *  confirm link to the new one (the account stays gated until confirmed). Lives
 *  outside the main "save changes" form — its own action. */
export function ChangeEmail({ email, verified, canChange }: { email: string; verified: boolean; canChange: boolean }) {
  const { update } = useSession();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await changeEmail(next);
      if (!r.ok) { setError(r.error); setBusy(false); return; }
      setSentTo(next.toLowerCase().trim());
      setOpen(false); setNext(""); setBusy(false);
      // Force the client session to refetch now (it otherwise waits for window
      // focus/poll) so the avatar's email reflects the change immediately — the
      // server session callback reads it live from the DB.
      void update();
    } catch {
      setError("something went wrong — please try again"); setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <p className="reg-blurb">
        we sent a confirmation to <strong>{sentTo}</strong> — click the link in it
        to finish the switch. until then you can still sign in with that address.
      </p>
    );
  }

  // Google accounts sign in by matching their Google email, so it can't be
  // changed here — show the address, no change control (the action rejects it
  // too, defensively).
  if (!canChange) {
    return (
      <p className="reg-blurb">
        signed in as <strong>{email}</strong>
        <span className="acct-unverified"> · via google (email managed by google)</span>
      </p>
    );
  }

  return (
    <div className="acct-email-row">
      <p className="reg-blurb">
        signed in as <strong>{email}</strong>
        {!verified && <span className="acct-unverified"> · unconfirmed — check your inbox</span>}
        {" · "}
        <button type="button" className="auth-link" onClick={() => { setOpen((o) => !o); setError(""); }}>
          {open ? "cancel" : "change email"}
        </button>
      </p>
      {open && (
        <form className="auth-form acct-email-form" onSubmit={submit}>
          {error && <div className="auth-error">{error}</div>}
          <label>new email
            <input type="email" value={next} onChange={(e) => setNext(e.target.value)}
              placeholder="you@email.com" autoComplete="email" required />
          </label>
          <button type="submit" className="btn-green" disabled={busy}>
            {busy ? "…" : "update email"}
          </button>
        </form>
      )}
    </div>
  );
}
