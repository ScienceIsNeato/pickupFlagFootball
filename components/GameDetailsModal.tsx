"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "@/lib/useEscape";
import { joinGame, leaveGame, setWeeklyAttendance } from "@/app/(app)/play/game-actions";

type GameInfo = {
  gameId: string;
  placeText: string;
  placeLat: number | null; placeLng: number | null;
  scheduledStart: string;
  isStanding: boolean; recurDow: number | null; recurTime: string | null;
  confirmedCount: number; status: string;
  city: string | null; zip: string | null;
  captains: string[];
  eligible: boolean; onRoster: boolean;
  myRsvp: "in" | "out" | null;
  rosterCount: number; inCount: number;
  nextOccurrence: string;
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
/** Parse a local YYYY-MM-DD without UTC drift, format as "Sun, Jun 22". */
function fmtDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

/** Details for an existing game, opened by clicking its flags on the map. */
export function GameDetailsModal({ lat, lng, onClose }: { lat: number; lng: number; onClose: () => void }) {
  const [state, setState] = useState<{ game: GameInfo | null; weeks: Week[] } | "loading" | "error">("loading");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");
  // Portal the modal to document.body so it escapes .dash-map's stacking
  // context (z:0) and renders above the floating site header (z:30).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEscape(onClose);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/game?lat=${lat}&lng=${lng}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { game: GameInfo | null; weeks?: Week[] };
      setState({ game: d.game, weeks: d.weeks ?? [] });
    } catch {
      setState("error");
    }
  }, [lat, lng]);

  useEffect(() => { load(); }, [load]);

  const game = state !== "loading" && state !== "error" ? state.game : null;
  const weeks = state !== "loading" && state !== "error" ? state.weeks : [];
  const playedCount = weeks.filter((w) => w.played).length;
  const maps = game?.placeLat != null && game?.placeLng != null
    ? `https://www.google.com/maps/search/?api=1&query=${game.placeLat},${game.placeLng}`
    : null;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setActionErr("");
    try {
      const res = await action();
      if (!res.ok) { setActionErr(res.error ?? "something went wrong"); return; }
      await load();
    } catch {
      setActionErr("something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;
  return createPortal((
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="game-details-title"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(6,10,8,.72)",
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
              <dt>regulars</dt>
              <dd>{game.rosterCount}</dd>
              {game.captains.length > 0 && (
                <>
                  <dt>captain{game.captains.length > 1 ? "s" : ""}</dt>
                  <dd>{game.captains.join(", ")}</dd>
                </>
              )}
            </dl>

            <div className="game-join-box">
              {game.onRoster ? (
                <>
                  <p className="game-rsvp-q">
                    coming {fmtDate(game.nextOccurrence)}?
                    <span className="game-muted"> · {game.inCount} in so far</span>
                  </p>
                  <div className="game-rsvp-row">
                    <button type="button" disabled={busy}
                      className={`game-rsvp-btn${game.myRsvp === "in" ? " is-in" : ""}`}
                      onClick={() => run(() => setWeeklyAttendance(game.gameId, "in"))}>i&apos;m in</button>
                    <button type="button" disabled={busy}
                      className={`game-rsvp-btn${game.myRsvp === "out" ? " is-out" : ""}`}
                      onClick={() => run(() => setWeeklyAttendance(game.gameId, "out"))}>can&apos;t make it</button>
                  </div>
                  <button type="button" className="game-leave" disabled={busy}
                    onClick={() => run(() => leaveGame(game.gameId))}>leave this game</button>
                </>
              ) : game.eligible ? (
                <>
                  <p className="game-rsvp-q">{game.inCount} in for {fmtDate(game.nextOccurrence)}</p>
                  <button type="button" className="btn-green game-join" disabled={busy}
                    onClick={() => run(() => joinGame(game.gameId))}>
                    {busy ? "…" : "join this game"}
                  </button>
                </>
              ) : (
                <p className="game-muted">this game is outside your travel radius — widen it in your <a href="/account">account</a> to join.</p>
              )}
              {actionErr && <p className="game-err">{actionErr}</p>}
            </div>

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
  ), document.body);
}
