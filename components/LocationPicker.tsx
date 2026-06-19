"use client";

import { useEffect, useRef, useState } from "react";

type Result = { name: string; detail: string; lat: number; lng: number };
type Picked = { name: string; lat: number; lng: number };

/**
 * Address/place picker for a public game spot. Search queries Photon (Komoot's
 * free, keyless OpenStreetMap geocoder), biased toward the map point so nearby
 * parks/fields/addresses surface first. A chosen result is shown as a selected
 * "pin" (not a bare text box); "change" reopens the search. The selection is
 * emitted as place / place_lat / place_lng and reported via onPick.
 */
export function LocationPicker({
  initial, onPick,
}: {
  initial?: Picked; // e.g. a reverse-geocoded address for a right-clicked spot
  onPick?: (p: Picked | null) => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(initial ?? null);
  const [editing, setEditing] = useState(!initial); // prefilled → start "selected"
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // report the prefilled selection once on mount
  useEffect(() => { onPick?.(initial ?? null); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!r.ok) return;
        const { results: out } = (await r.json()) as { results: Result[] };
        setResults(out);
        setOpen(out.length > 0);
      } catch { /* aborted or offline — ignore */ }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  function choose(r: Result) {
    const p = { name: r.name, lat: r.lat, lng: r.lng };
    setPicked(p); onPick?.(p);
    setQ(""); setResults([]); setOpen(false); setEditing(false);
  }

  function startEditing() {
    setEditing(true); setPicked(null); onPick?.(null); setQ("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{ position: "relative" }}>
      {/* selection feeds the form */}
      <input type="hidden" name="place" value={picked?.name ?? ""} />
      <input type="hidden" name="place_lat" value={picked?.lat ?? ""} />
      <input type="hidden" name="place_lng" value={picked?.lng ?? ""} />

      {!editing && picked ? (
        <div className="loc-picked">
          <span className="loc-pin" aria-hidden>📍</span>
          <span className="loc-picked-name">{picked.name}</span>
          <button type="button" className="loc-change" onClick={startEditing}>change</button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            autoComplete="off"
            placeholder="search a park, field, or address…"
            value={q}
            onChange={(e) => { setQ(e.target.value); if (picked) { setPicked(null); onPick?.(null); } }}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
          />
          {open && results.length > 0 && (
            <ul className="loc-results">
              {results.map((r, i) => (
                <li
                  key={i}
                  onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                  className="loc-result"
                >
                  <div className="loc-result-name">{r.name}</div>
                  {r.detail && <div className="loc-result-detail">{r.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
