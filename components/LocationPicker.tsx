"use client";

import { useEffect, useRef, useState } from "react";

type Result = { name: string; detail: string; lat: number; lng: number };

/**
 * Place autocomplete for picking a public spot. Queries Photon (Komoot's free,
 * keyless OpenStreetMap geocoder), biased toward the area's center so nearby
 * parks/fields surface first. Emits the chosen name + lat/lng as form fields
 * (place / place_lat / place_lng).
 */
export function LocationPicker({ bias }: { bias?: { lat: number; lng: number } }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [picked, setPicked] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const skipNext = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A suggestion needs real coordinates, which only exist once a result is
  // chosen from the list. Free-typed text submits null coords, so block the
  // form via constraint validation until a row is picked (and re-block if the
  // user edits the text afterward, since the coords would no longer match).
  useEffect(() => {
    inputRef.current?.setCustomValidity(picked ? "" : "Pick a spot from the list");
  }, [picked]);

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const b = bias ? `&lat=${bias.lat}&lon=${bias.lng}` : "";
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${b}`,
          { signal: ctrl.signal }
        );
        if (!r.ok) return;
        const d = await r.json();
        const out: Result[] = (d.features ?? [])
          .filter((f: { geometry?: { coordinates?: number[] } }) => f.geometry?.coordinates)
          .map((f: { properties: Record<string, string>; geometry: { coordinates: number[] } }) => ({
            name: f.properties.name || f.properties.street || "unnamed spot",
            detail: [f.properties.city, f.properties.state, f.properties.country].filter(Boolean).join(", "),
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          }));
        setResults(out);
        setOpen(out.length > 0);
      } catch { /* aborted or offline — ignore */ }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, bias]);

  function choose(r: Result) {
    skipNext.current = true;
    setPicked(r);
    setQ(r.name);
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        name="place"
        autoComplete="off"
        required
        placeholder="search a park, field, school…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPicked(null); }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      <input type="hidden" name="place_lat" value={picked?.lat ?? ""} />
      <input type="hidden" name="place_lng" value={picked?.lng ?? ""} />
      {open && results.length > 0 && (
        <ul style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, margin: "4px 0 0",
          padding: 0, listStyle: "none", maxHeight: 220, overflowY: "auto",
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        }}>
          {results.map((r, i) => (
            <li
              key={i}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ fontSize: 14, color: "var(--ink)" }}>{r.name}</div>
              {r.detail && <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
