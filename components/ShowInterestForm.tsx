"use client";

import { useState } from "react";

/**
 * Phase-1 placeholder: ports the static register form. Front-end only — real
 * signup (Google auth) + persistence land in Phase 2/3, when this moves into the
 * auth-gated app group and submits an interest signal.
 */
export function ShowInterestForm({ cta, note }: { cta: string; note: string }) {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="reg-done">
        thanks - this is a preview for now. real signups go live once the backend&apos;s wired up.
      </p>
    );
  }

  return (
    <form
      className="reg-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!e.currentTarget.reportValidity()) return;
        setDone(true);
      }}
    >
      <label>
        name
        <input type="text" name="name" placeholder="your name" autoComplete="name" required />
      </label>
      <label>
        email
        <input type="email" name="email" placeholder="you@email.com" autoComplete="email" required />
      </label>
      <label>
        zip
        <input
          type="text"
          name="zip"
          placeholder="52241"
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[0-9]{5}"
          required
        />
      </label>
      <button type="submit" className="btn-green">{cta}</button>
      <p className="reg-note">{note}</p>
    </form>
  );
}
