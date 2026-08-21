"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose } from "@/components/icons";

export type FoundAddress = {
  label: string; line1: string; city: string; state: string; zip: string;
  lat: number; lng: number;
};

/**
 * Address autocomplete for registration (audit follow-up: the free-text
 * ZIP/street pile accepted garbage and iOS suppressed the native validation
 * bubbles, so bad submits failed silently). This only produces VALIDATED
 * addresses: you pick from real results (ZIPs resolve locally, streets via
 * the geocoder) or you don't proceed. Selection is delivered to the parent
 * and shown as a removable chip.
 */
export function AddressFinder({ value, onSelect }: {
  value: FoundAddress | null;
  onSelect: (a: FoundAddress | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoundAddress[]>([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "searching" | "empty" | "error">("idle");
  const [hi, setHi] = useState(-1); // highlighted row for arrow keys
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const query = q.trim();
    if (query.length < 3) { setResults([]); setOpen(false); setState("idle"); return; }
    setState("searching");
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/address-search?q=${encodeURIComponent(query)}`);
        if (!r.ok) { setState("error"); setOpen(true); return; }
        const d = (await r.json()) as { results: FoundAddress[] };
        setResults(d.results);
        setHi(d.results.length ? 0 : -1);
        setState(d.results.length ? "idle" : "empty");
        setOpen(true);
      } catch {
        setState("error"); setOpen(true);
      }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  // tap-away closes the list
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function pick(a: FoundAddress) {
    onSelect(a);
    setQ(""); setResults([]); setOpen(false); setState("idle");
  }

  // iOS: the keyboard-dismiss relayout can move a row between touchstart and
  // the synthesized click, eating the tap. Pick on pointerup instead, with a
  // small movement guard so scrolling the list never counts as a pick.
  const downAt = useRef<{ x: number; y: number } | null>(null);

  if (value) {
    return (
      <div className="addr-chip" data-testid="addr-selected">
        <span className="addr-chip-label">{value.label}</span>
        <button type="button" className="addr-chip-x" aria-label="change address"
          onClick={() => onSelect(null)}><IconClose size={15} /></button>
      </div>
    );
  }

  return (
    <div className="addr-finder" ref={boxRef}>
      <input
        type="text" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="ZIP code, or start typing your address"
        autoComplete="off" inputMode="text" aria-label="find your address"
        role="combobox" aria-expanded={open} aria-controls="addr-results"
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (hi >= 0) pick(results[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {state === "searching" && <p className="addr-hint">searching…</p>}
      {open && (
        <ul className="addr-results" id="addr-results" role="listbox">
          {results.map((r, i) => (
            <li key={r.label}>
              <button type="button" role="option" aria-selected={i === hi}
                className={`addr-result${i === hi ? " addr-result--hi" : ""}`}
                onPointerDown={(e) => { downAt.current = { x: e.clientX, y: e.clientY }; }}
                onPointerUp={(e) => {
                  const d = downAt.current;
                  if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) pick(r);
                  downAt.current = null;
                }}
                onClick={(e) => e.preventDefault()}>
                {r.label}
              </button>
            </li>
          ))}
          {state === "empty" && <li className="addr-hint">no matches - try your 5-digit ZIP</li>}
          {state === "error" && <li className="addr-hint">address search hiccuped - try your 5-digit ZIP</li>}
        </ul>
      )}
    </div>
  );
}
