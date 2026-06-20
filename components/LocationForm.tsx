"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveLocationAndInterest, type LocationResult } from "@/app/(app)/show-interest/actions";

type Initial = { zip: string; line1: string; line2: string; city: string; state: string };

/** The signed-in location form (e.g. finishing onboarding after a Google sign-in).
 *  Returns validation errors inline instead of throwing, so a bad ZIP keeps the
 *  user in the form. On success the action saves interest and we head to the map. */
export function LocationForm({ initial, cta, note }: { initial: Initial; cta: string; note: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (_prev: LocationResult | null, fd: FormData) => saveLocationAndInterest(fd),
    null,
  );
  useEffect(() => { if (state?.ok) router.push("/play"); }, [state, router]);

  return (
    <form className="reg-form" action={action}>
      <label>
        zip code
        <input type="text" name="zip" placeholder="52241" inputMode="numeric"
          autoComplete="postal-code" pattern="[0-9]{5}" required defaultValue={initial.zip} />
      </label>
      <p className="reg-section">your address <span className="reg-optional">(optional — sharpens distance to games)</span></p>
      <label>
        street address
        <input type="text" name="address_line1" placeholder="1806 Brown Deer Trail"
          autoComplete="address-line1" defaultValue={initial.line1} />
      </label>
      <label>
        apt / suite / unit
        <input type="text" name="address_line2" placeholder="Apt 4"
          autoComplete="address-line2" defaultValue={initial.line2} />
      </label>
      <div className="reg-row">
        <label>
          city
          <input type="text" name="city" placeholder="Coralville"
            autoComplete="address-level2" defaultValue={initial.city} />
        </label>
        <label className="reg-state">
          state
          <input type="text" name="state" placeholder="IA" autoComplete="address-level1"
            maxLength={20} defaultValue={initial.state} />
        </label>
      </div>
      <p className="reg-hint">
        we only use your address to measure how far games are from you. we never
        show it to anyone or sell it — see our <Link href="/privacy">privacy page</Link>.
      </p>
      {state && !state.ok && <p className="field-err" role="alert" aria-live="assertive">{state.error}</p>}
      <button type="submit" className="btn-green" disabled={pending}>{pending ? "…" : cta}</button>
      <p className="reg-note">{note}</p>
    </form>
  );
}
