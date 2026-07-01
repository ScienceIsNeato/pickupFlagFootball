"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useEscape } from "@/lib/useEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { proposeGame } from "@/app/(app)/play/propose-actions";
import { reverseGeocode } from "@/lib/geo/reverseGeocode";
import { haversineKm } from "@/lib/geo/distance";
import {
  DOW_NAMES, gameTimeOptions, upcomingDatesForDow, combineDateTimeToISO,
} from "@/lib/datetime";

const TIME_OPTS = gameTimeOptions();

const ERRORS: Record<string, string> = {
  missing: "Please fill in the address and a day, time, and date.",
  scheduled: "There's already a game scheduled at this spot.",
  closed: "This area's suggestion window just closed - try again soon.",
  cooldown: "This area is cooling down after a recent attempt - try again later.",
  nolocation: "Set your home address on your account before proposing.",
  outofrange: "This spot is outside your travel radius - raise it from /account to propose here.",
  unverified: "Confirm your email before proposing a game - check your inbox.",
  retry: "Something hiccuped - please try again.",
};

type Home = { lat: number; lng: number; maxTravelKm: number; city: string | null; zip: string | null };
const kmToMi = (km: number) => Math.round(km / 1.609);

/** The success card shown after a successful propose. Extracted so the modal's
 *  main component stays under the sprawl limit. */
function ProposeSuccessCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="reg-form"
      style={{ width: 380, maxWidth: "92%", background: "var(--surface)",
        border: "1px solid var(--border)", borderRadius: 12, padding: 24, backdropFilter: "blur(8px)" }}>
      <h2 id="propose-title" style={{ fontFamily: "var(--font-barlow), sans-serif", fontSize: 22, margin: "0 0 6px" }}>
        Game proposed!
      </h2>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 10px", lineHeight: 1.55 }}>
        We&apos;ll see if any other games have been proposed in the area and spend the interest window
        gathering interest. At the end of that window, we&apos;ll let you know if a game has formed or not.
      </p>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 14px", lineHeight: 1.55 }}>
        That&apos;s all you have to do for now - thank you for supporting community sports!
      </p>
      <button type="button" className="btn-green" onClick={onClose}>got it</button>
    </div>
  );
}

/** Propose-a-game flow, opened by right-clicking a spot on the map. The exact
 *  clicked point is the location; the address fields (prefilled by reverse-geocode)
 *  describe it, and notes carry meeting details ("east lot, gate code 1234"). */
export function ProposeModal({
  h3, center, home, onClose, onProposed,
}: {
  h3: string; center: { lat: number; lng: number }; home: Home | null;
  onClose: () => void; onProposed: (p: { lat: number; lng: number }) => void;
}) {
  const [state, formAction, pending] = useActionState(proposeGame, null);
  // Portal to document.body to escape .dash-map's stacking context.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEscape(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, mounted);

  // Is the right-clicked spot inside the user's travel radius? If not, the
  // dialog leads with an "increase your radius" message and disables submit.
  const distKm = home ? haversineKm(home.lat, home.lng, center.lat, center.lng) : null;
  const outOfRange = home != null && distKm != null && distKm > home.maxTravelKm;

  // On success: drop the proposed badge on the map at the clicked point.
  useEffect(() => {
    if (state?.ok) onProposed(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // City + ZIP default to the user's own — they're proposing inside their area.
  // Street starts empty (the reverse-geocoder fills it if it finds one).
  const [street, setStreet] = useState("");
  const [city, setCity] = useState(home?.city ?? "");
  const [zip, setZip] = useState(home?.zip ?? "");
  const [notes, setNotes] = useState("");

  // Prefill the address from the clicked point (only fill blanks, never clobber edits).
  useEffect(() => {
    const ctrl = new AbortController();
    reverseGeocode(center.lat, center.lng, ctrl.signal).then((r) => {
      if (!r) return;
      if (r.street) setStreet((v) => v || r.street!);
      if (r.city) setCity((v) => v || r.city!);
      if (r.zip) setZip((v) => v || r.zip!);
    });
    return () => ctrl.abort();
  }, [center.lat, center.lng]);

  const [dow, setDow] = useState("");
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const dates = dow !== "" ? upcomingDatesForDow(Number(dow), 8, new Date()) : [];

  // Show "this field is required" only after the user tries to submit (so the
  // form doesn't look angry on open) — or once they've touched the field.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showInvalid, setShowInvalid] = useState(false);
  const errs = {
    street: !street.trim() && "street or spot name is required",
    city: !city.trim() && "city is required",
    zip: !/^\d{5}$/.test(zip.trim()) && (zip.trim() ? "zip should be 5 digits" : "zip is required"),
    dow: dow === "" && "pick a day",
    time: time === "" && "pick a time",
    date: !date && "pick a date",
  } as const;
  const show = (k: keyof typeof errs) => (touched[k] || showInvalid) && errs[k];

  const iso = combineDateTimeToISO(date, time);
  const ready = !outOfRange && Object.values(errs).every((e) => !e) && iso !== "";
  const onInvalidSubmit = (e: React.FormEvent) => {
    if (!ready) { e.preventDefault(); setShowInvalid(true); }
  };

  if (!mounted) return null;
  return createPortal((
    <div
      ref={dialogRef} tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="propose-title"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(6,10,8,.72)",
        display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {state?.ok ? <ProposeSuccessCard onClose={onClose} /> : (
      <form action={formAction} onSubmit={onInvalidSubmit} noValidate className="reg-form"
        style={{ width: 380, maxWidth: "92%", maxHeight: "88%", overflowY: "auto",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
          padding: 24, backdropFilter: "blur(8px)" }}>
        <input type="hidden" name="h3" value={h3} />
        <input type="hidden" name="place_lat" value={center.lat} />
        <input type="hidden" name="place_lng" value={center.lng} />
        <h2 id="propose-title" style={{ fontFamily: "var(--font-barlow), sans-serif", fontSize: 22, margin: "0 0 4px" }}>
          propose a game
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
          name a public spot and a weekly time. neighbors who showed interest get asked if they&apos;d come.
        </p>

        {/* Top-of-dialog: out-of-range (lead with the actionable message) */}
        {outOfRange && home && distKm != null && (
          <div className="auth-error">
            this spot is about {kmToMi(distKm)} mi from your home - outside your {kmToMi(home.maxTravelKm)}-mile area of interest.{" "}
            <Link href="/account">increase your radius</Link> to propose a game here.
          </div>
        )}
        {/* Server-returned reasons that aren't already shown as a field-level hint */}
        {state && !state.ok && ERRORS[state.reason] && (
          <div className="auth-error">{ERRORS[state.reason]}</div>
        )}

        <label>
          street / spot
          <input name="place_street" value={street}
            onChange={(e) => setStreet(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, street: true }))}
            placeholder="1806 Brown Deer Trail / Morrison Park" autoComplete="off" />
          {show("street") && <span className="field-err">{errs.street}</span>}
        </label>
        <div className="reg-row">
          <label>
            city
            <input name="place_city" value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, city: true }))}
              placeholder="Coralville" autoComplete="off" />
            {show("city") && <span className="field-err">{errs.city}</span>}
          </label>
          <label className="reg-state">
            zip
            <input name="place_zip" value={zip}
              onChange={(e) => setZip(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, zip: true }))}
              inputMode="numeric" placeholder="52241" autoComplete="off" />
            {show("zip") && <span className="field-err">{errs.zip}</span>}
          </label>
        </div>
        <label>
          notes <span className="reg-optional">(optional - where to meet, parking, gate code…)</span>
          <textarea name="place_notes" value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2} placeholder="park in the east lot - gate code 1234" />
        </label>

        <label>
          day of week
          <select value={dow}
            onChange={(e) => { setDow(e.target.value); setDate(""); setTouched((t) => ({ ...t, dow: true })); }}>
            <option value="" disabled>pick a day</option>
            {DOW_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
          </select>
          {show("dow") && <span className="field-err">{errs.dow}</span>}
        </label>
        <label>
          time
          <select value={time}
            onChange={(e) => { setTime(e.target.value); setTouched((t) => ({ ...t, time: true })); }}>
            <option value="" disabled>pick a time</option>
            {TIME_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {show("time") && <span className="field-err">{errs.time}</span>}
        </label>
        <label>
          date of the first game
          <select value={date} disabled={dow === ""}
            onChange={(e) => { setDate(e.target.value); setTouched((t) => ({ ...t, date: true })); }}>
            <option value="" disabled>{dow === "" ? "pick a day first" : "pick a date"}</option>
            {dates.map((d) => {
              const [y, m, day] = d.split("-").map(Number);
              const label = new Date(y, m - 1, day).toLocaleDateString(undefined,
                { month: "short", day: "numeric", year: "numeric" });
              return <option key={d} value={d}>{label}</option>;
            })}
          </select>
          {show("date") && <span className="field-err">{errs.date}</span>}
        </label>

        <input type="hidden" name="start" value={iso} />
        <input type="hidden" name="recur_dow" value={dow} />
        <input type="hidden" name="recur_time" value={time} />

        <button className="btn-green" type="submit" disabled={outOfRange || pending}>
          {pending ? "proposing…" : "propose it"}
        </button>
        <button type="button" onClick={onClose}
          style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer",
            fontSize: 13, marginTop: 2 }}>cancel</button>
      </form>
      )}
    </div>
  ), document.body);
}
