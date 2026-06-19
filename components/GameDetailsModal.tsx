"use client";

import { useEffect, useState } from "react";
import { useEscape } from "@/lib/useEscape";

type GameInfo = {
  placeText: string;
  placeLat: number | null; placeLng: number | null;
  scheduledStart: string;
  isStanding: boolean; recurDow: number | null; recurTime: string | null;
  confirmedCount: number; status: string;
  city: string | null; zip: string | null;
  captains: string[];
};
type Week = { weekStart: string; played: boolean; count: number };

const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function fmtTime(t?: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
}
function weeklyTime(g: GameInfo): string {
  if (g.isStanding && g.recurDow != null && g.recurDow >= 0 && g.recurDow < DOW.length && g.recurTime) {
    return `${DOW[g.recurDow]} at ${fmtTime(g.recurTime)}`;
  }
  return new Date(g.scheduledStart).toLocaleString(undefined, {
    weekday: "long", hour: "numeric", minute: "2-digit",
  });
}

/** Details for an existing game, opened by clicking its flags on the map. */
export function GameDetailsModal({ lat, lng, onClose }: { lat: number; lng: number; onClose: () => void }) {
  const [state, setState] = useState<{ game: GameInfo | null; weeks: Week[] } | "loading" | "error">("loading");
  const [open, setOpen] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/game?lat=${lat}&lng=${lng}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { game: GameInfo | null; weeks?: Week[] };
        if (!cancelled) setState({ game: d.game, weeks: d.weeks ?? [] });
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  const game = state !== "loading" && state !== "error" ? state.game : null;
  const weeks = state !== "loading" && state !== "error" ? state.weeks : [];
  const playedCount = weeks.filter((w) => w.played).length;
  const maps = game?.placeLat != null && game?.placeLng != null
    ? `https://www.google.com/maps/search/?api=1&query=${game.placeLat},${game.placeLng}`
    : null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="game-details-title"
      style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(6,10,8,.72)",
        display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="game-card">
        <button type="button" className="game-close" onClick={onClose} aria-label="close">×</button>
        {state === "loading" && <p className="game-muted">loading…</p>}
        {state === "error" && <p className="game-muted">couldn&apos;t load this game.</p>}
        {state !== "loading" && state !== "error" && !game && <p className="game-muted">no game here yet.</p>}
        {game && (
          <>
            <h2 id="game-details-title" className="game-h">{game.isStanding ? "standing game" : "game on"}</h2>
            <dl className="game-dl">
              <dt>where</dt>
              <dd>
                {game.placeText}
                {game.city ? <span className="game-muted"> · {game.city}{game.zip ? ` ${game.zip}` : ""}</span> : null}
                {maps ? <> · <a href={maps} target="_blank" rel="noopener noreferrer">directions</a></> : null}
              </dd>
              <dt>weekly time</dt>
              <dd>{weeklyTime(game)}</dd>
              <dt>players in</dt>
              <dd>{game.confirmedCount}</dd>
              {game.captains.length > 0 && (
                <>
                  <dt>captain{game.captains.length > 1 ? "s" : ""}</dt>
                  <dd>{game.captains.join(", ")}</dd>
                </>
              )}
            </dl>
            <button type="button" className="game-collapse" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <span className="game-caret">{open ? "▾" : "▸"}</span>
              recent games
              <span className="game-muted"> · played {playedCount} of last {weeks.length} weeks</span>
            </button>
            {open && (
              <ul className="game-recent">
                {weeks.map((w, i) => (
                  <li key={i}>
                    <span>{new Date(w.weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    {w.played
                      ? <span className="game-played">✓ played · {w.count} in</span>
                      : <span className="game-muted">— no game</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
