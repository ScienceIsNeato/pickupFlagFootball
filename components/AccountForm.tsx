"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { updateAccount } from "@/app/(app)/account/actions";

type Initial = {
  displayName: string;
  zip: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  travelMiles: number;
};

/** The profile form. Client component so the submit button can flip to
 *  "saving changes…" while the action runs and a success popup can appear on
 *  completion (the server action returns a result instead of redirecting). */
export function AccountForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState(updateAccount, null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Show the success popup when a save completes; auto-dismiss after a beat.
  const [toast, setToast] = useState(false);
  useEffect(() => {
    if (state?.ok) {
      setToast(true);
      const t = setTimeout(() => setToast(false), 2600);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <>
      <form className="reg-form" action={formAction}>
        <label>
          display name
          <input type="text" name="displayName" placeholder="first name or nickname"
            defaultValue={initial.displayName} autoComplete="given-name" />
        </label>
        <label>
          zip code
          <input type="text" name="zip" placeholder="52241" inputMode="numeric"
            autoComplete="postal-code" pattern="[0-9]{5}" required defaultValue={initial.zip} />
        </label>
        <p className="reg-section">your address <span className="reg-optional">(optional — sharpens distance to games)</span></p>
        <label>
          street address
          <input type="text" name="address_line1" placeholder="1806 Brown Deer Trail"
            autoComplete="address-line1" defaultValue={initial.addressLine1} />
        </label>
        <label>
          apt / suite / unit
          <input type="text" name="address_line2" placeholder="Apt 4"
            autoComplete="address-line2" defaultValue={initial.addressLine2} />
        </label>
        <div className="reg-row">
          <label>
            city
            <input type="text" name="city" placeholder="Coralville"
              defaultValue={initial.city} autoComplete="address-level2" />
          </label>
          <label className="reg-state">
            state
            <input type="text" name="state" placeholder="IA" maxLength={20}
              defaultValue={initial.state} autoComplete="address-level1" />
          </label>
        </div>
        <label>
          how far will you travel? (miles)
          <input type="number" name="max_travel_miles" min="1" max="100" step="1"
            defaultValue={initial.travelMiles} inputMode="numeric" />
        </label>
        <p className="reg-hint">
          your address and travel distance are only used to measure how far games
          are from you — never shown to anyone. <Link href="/privacy">privacy</Link>.
        </p>
        {state && !state.ok && <div className="auth-error">{state.error}</div>}
        <button type="submit" className="btn-green" disabled={pending}>
          {pending ? "saving changes…" : "save changes"}
        </button>
      </form>

      {mounted && toast && createPortal(
        <div className="save-toast" role="status" aria-live="polite" onClick={() => setToast(false)}>
          <span className="save-toast-check" aria-hidden>✓</span> Changes successfully saved
        </div>,
        document.body,
      )}
    </>
  );
}
