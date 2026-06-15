"use client";

import { proposeGame } from "@/app/(app)/dashboard/propose-actions";
import { LocationPicker } from "./LocationPicker";

/** The suggest-a-game flow, opened from a football on the map. */
export function ProposeModal({
  h3, center, onClose,
}: { h3: string; center?: { lat: number; lng: number }; onClose: () => void }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(6,10,8,.72)",
        display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <form action={proposeGame} className="reg-form"
        style={{ width: 360, maxWidth: "92%", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 12, padding: 24,
          backdropFilter: "blur(8px)" }}>
        <input type="hidden" name="h3" value={h3} />
        <h2 style={{ fontFamily: "var(--font-barlow), sans-serif", fontSize: 22, margin: "0 0 4px" }}>
          propose a game
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
          name a public spot and a time. neighbors who showed interest get asked if they&apos;d come.
        </p>
        <label>
          where
          <LocationPicker bias={center} />
        </label>
        <label>
          when
          <input name="start" type="datetime-local" required />
        </label>
        <button className="btn-green" type="submit">propose it</button>
        <button type="button" onClick={onClose}
          style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer",
            fontSize: 13, marginTop: 2 }}>cancel</button>
      </form>
    </div>
  );
}
