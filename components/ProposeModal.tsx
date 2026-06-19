"use client";

import { useEffect, useState } from "react";
import { proposeGame } from "@/app/(app)/play/propose-actions";
import { LocationPicker } from "./LocationPicker";
import { reverseGeocode } from "@/lib/geo/reverseGeocode";
import {
  DOW_NAMES, gameTimeOptions, upcomingDatesForDow, combineDateTimeToISO,
} from "@/lib/datetime";

const TIME_OPTS = gameTimeOptions();

/** The suggest-a-game flow, opened by right-clicking a spot on the map. */
export function ProposeModal({
  h3, center, onClose,
}: { h3: string; center: { lat: number; lng: number }; onClose: () => void }) {
  // Reverse-geocode the right-clicked point for a "closest address" prefill. We
  // gate the form on the lookup finishing so LocationPicker mounts with the
  // address already in place (it reads `initial` once). null = no match → plain
  // search field.
  const [addr, setAddr] = useState<string | null>(null);
  const [geoDone, setGeoDone] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    reverseGeocode(center.lat, center.lng, ctrl.signal)
      .then((r) => { if (r) setAddr(r.address); })
      .finally(() => setGeoDone(true));
    return () => ctrl.abort();
  }, [center.lat, center.lng]);

  // Day-of-week → time → first-date. The date list is the next few occurrences
  // of the chosen weekday, so the first game is always in the future.
  const [dow, setDow] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [hasPlace, setHasPlace] = useState(false);
  const dates = dow !== "" ? upcomingDatesForDow(Number(dow), 8, new Date()) : [];

  const iso = combineDateTimeToISO(date, time);
  const ready = geoDone && hasPlace && iso !== "";

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
          name a public spot and a weekly time. neighbors who showed interest get asked if they&apos;d come.
        </p>

        <label>
          where
          {geoDone ? (
            <LocationPicker
              initial={addr ? { name: addr, lat: center.lat, lng: center.lng } : undefined}
              onPick={(p) => setHasPlace(!!p)}
            />
          ) : (
            <input disabled placeholder="finding closest address…" />
          )}
        </label>

        <label>
          day of week
          <select required value={dow} onChange={(e) => { setDow(e.target.value); setDate(""); }}>
            <option value="" disabled>pick a day</option>
            {DOW_NAMES.map((name, i) => (
              <option key={i} value={i}>{name}</option>
            ))}
          </select>
        </label>

        <label>
          time
          <select required value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="" disabled>pick a time</option>
            {TIME_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label>
          date of the first game
          <select required value={date} disabled={dow === ""}
            onChange={(e) => setDate(e.target.value)}>
            <option value="" disabled>{dow === "" ? "pick a day first" : "pick a date"}</option>
            {dates.map((d) => {
              const [y, m, day] = d.split("-").map(Number);
              const label = new Date(y, m - 1, day).toLocaleDateString(undefined,
                { month: "short", day: "numeric", year: "numeric" });
              return <option key={d} value={d}>{label}</option>;
            })}
          </select>
        </label>

        {/* recurrence + first-game instant for the server */}
        <input type="hidden" name="start" value={iso} />
        <input type="hidden" name="recur_dow" value={dow} />
        <input type="hidden" name="recur_time" value={time} />

        <button className="btn-green" type="submit" disabled={!ready}>propose it</button>
        <button type="button" onClick={onClose}
          style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer",
            fontSize: 13, marginTop: 2 }}>cancel</button>
      </form>
    </div>
  );
}
