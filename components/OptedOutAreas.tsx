"use client";

import { useState } from "react";
import { reExpressInterest } from "@/app/(app)/play/optout-actions";

/** Lists the areas the user opted out of (via the email "not interested" link)
 *  with a one-click way back in. Without this the opt-out is a one-way door once
 *  no proposal is open in that area. */
export function OptedOutAreas({ areas }: { areas: { areaId: string; label: string }[] }) {
  const [list, setList] = useState(areas);
  const [busy, setBusy] = useState<string | null>(null);

  if (list.length === 0) return null;

  async function rejoin(areaId: string) {
    setBusy(areaId);
    try {
      const r = await reExpressInterest(areaId);
      if (r.ok) { setList((l) => l.filter((a) => a.areaId !== areaId)); return; }
    } catch { /* fall through to re-enable the button */ }
    setBusy(null);
  }

  return (
    <div className="acct-vitals">
      <p className="reg-section">areas you&apos;ve opted out of</p>
      <p className="reg-hint">you said you&apos;re not interested in these. changed your mind?</p>
      <ul className="acct-vitals-list">
        {list.map((a) => (
          <li key={a.areaId}>
            <span>{a.label}</span>
            <button type="button" className="auth-link" disabled={busy === a.areaId}
              onClick={() => rejoin(a.areaId)}>
              {busy === a.areaId ? "…" : "i'm interested again"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
