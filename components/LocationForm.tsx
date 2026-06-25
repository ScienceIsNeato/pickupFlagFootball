"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateLocation } from "@/app/(app)/account/actions";
import { useSaveToast } from "./useSaveToast";

type Initial = {
  zip: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  travelMiles: number;
};

/** The "location" card (right column) — ZIP / address / travel radius. Saving it
 *  re-points your interest to the resolved area. */
export function LocationForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState(updateLocation, null);
  const toast = useSaveToast(state);
  return (
    <>
      <form className="reg-form" action={formAction}>
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
          {pending ? "saving…" : "save location"}
        </button>
      </form>
      {toast}
    </>
  );
}
