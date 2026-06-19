"use client";

import { useEffect, useState } from "react";

type Entry = { placeText: string; proposedStart: string; votes?: number };
type Site = { city: string | null; zip: string | null; status: string | null; captains: string[] };
type Data = { site: Site | null; suggestions: Entry[]; options: Entry[] };

const STATUS_LABEL: Record<string, string> = {
  SUGGESTING: "collecting suggestions",
  COMPILING: "tallying suggestions",
  AVAILABILITY: "voting open",
  ADJUDICATING: "picking a winner",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** Details for a proposed (forming) game site, opened by clicking its badge. */
export function ProposedDetailsModal({ lat, lng, onClose }: { lat: number; lng: number; onClose: () => void }) {
  const [state, setState] = useState<Data | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/proposed?lat=${lat}&lng=${lng}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const d = (await r.json()) as Data;
        if (!cancelled) setState(d);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  const data = state !== "loading" && state !== "error" ? state : null;
  const site = data?.site ?? null;
  // Prefer voted options; fall back to raw suggestions while voting hasn't opened.
  const voted = (data?.options ?? []).filter((o) => (o.votes ?? 0) > 0);
  const entries = voted.length ? voted : data?.suggestions ?? [];
  const showingVotes = voted.length > 0;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(6,10,8,.72)",
        display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="game-card">
        <button type="button" className="game-close" onClick={onClose} aria-label="close">×</button>
        {state === "loading" && <p className="game-muted">loading…</p>}
        {state === "error" && <p className="game-muted">couldn&apos;t load this site.</p>}
        {state !== "loading" && state !== "error" && !site && <p className="game-muted">no proposed site here.</p>}
        {site && (
          <>
            <h2 className="game-h">proposed game site</h2>
            <dl className="game-dl">
              <dt>where</dt>
              <dd>{site.city ?? "this area"}{site.zip ? <span className="game-muted"> · {site.zip}</span> : null}</dd>
              <dt>status</dt>
              <dd>{(site.status && STATUS_LABEL[site.status]) ?? "forming"}</dd>
              {site.captains.length > 0 && (
                <>
                  <dt>captain{site.captains.length > 1 ? "s" : ""}</dt>
                  <dd>{site.captains.join(", ")}</dd>
                </>
              )}
            </dl>

            {entries.length > 0 ? (
              <>
                <div className="game-collapse" style={{ cursor: "default" }}>
                  {showingVotes ? "votes so far" : "suggested so far"}
                </div>
                <ul className="game-recent">
                  {entries.map((e, i) => (
                    <li key={i}>
                      <span>{e.placeText} <span className="game-muted">· {when(e.proposedStart)}</span></span>
                      {showingVotes
                        ? <span className="game-played">{e.votes} {e.votes === 1 ? "vote" : "votes"}</span>
                        : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="game-muted">
                a game is forming here. interested players nearby get asked to suggest a time and vote — be the first to weigh in.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
