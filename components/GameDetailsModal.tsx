"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "@/lib/useEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { joinWeeklyGame, setRosterMembership } from "@/app/(app)/play/game-actions";
import { pauseSeries, resumeSeries, retireSeries, cancelWeek } from "@/app/(app)/play/captain-actions";

type GameInfo = {
  gameId: string;
  placeText: string;
  placeLat: number | null; placeLng: number | null;
  scheduledStart: string;
  isStanding: boolean; recurDow: number | null; recurTime: string | null;
  confirmedCount: number; status: string;
  city: string | null; zip: string | null;
  captains: string[];
  viewerIsCaptain: boolean;
  eligible: boolean; onRoster: boolean;
  myDefault: "in" | "out" | null;
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
  // Type-to-confirm gate for the destructive captain actions (pause / retire).
  const [confirmReq, setConfirmReq] =
    useState<null | { title: string; phrase: string; confirmLabel: string; onConfirm: () => void }>(null);
  const [typed, setTyped] = useState("");
  const [pref, setPref] = useState<"regular" | "occasional">("regular");
  const [nextIn, setNextIn] = useState(true);
  // Portal the modal to document.body so it escapes .dash-map's stacking
  // context (z:0) and renders above the floating site header (z:30).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Escape closes the confirm dialog first (if open), else the whole modal.
  useEscape(useCallback(() => {
    if (confirmReq) setConfirmReq(null);
    else onClose();
  }, [confirmReq, onClose]));
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, mounted);

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

  // Sync the sliders from persisted state whenever the game (re)loads. A
  // not-yet-joined viewer defaults to regular + in (they're about to join).
  useEffect(() => {
    if (!game) return;
    setPref(game.myDefault === "out" ? "occasional" : "regular");
    // Effective next-game RSVP: explicit override wins, else the site default.
    const effectiveNext = game.myRsvp ?? game.myDefault ?? "in";
    setNextIn(game.onRoster ? effectiveNext === "in" : true);
  }, [game?.gameId, game?.onRoster, game?.myDefault, game?.myRsvp]);

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

  function askConfirm(req: { title: string; phrase: string; confirmLabel: string; onConfirm: () => void }) {
    setTyped("");
    setConfirmReq(req);
  }

  if (!mounted) return null;
  return createPortal((
    <div
      ref={dialogRef} tabIndex={-1}
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
              {game.status === "paused" ? (
                <p className="game-muted">this game is paused by the captain — no games are running right now.</p>
              ) : game.eligible || game.onRoster ? (
                <>
                  <p className="game-join-h">join weekly game</p>
                  <div className="seg" role="group" aria-label="how often you'll play">
                    <button type="button" className={pref === "regular" ? "seg-on" : ""}
                      aria-pressed={pref === "regular"} disabled={busy} onClick={() => setPref("regular")}>regular player</button>
                    <button type="button" className={pref === "occasional" ? "seg-on" : ""}
                      aria-pressed={pref === "occasional"} disabled={busy} onClick={() => setPref("occasional")}>occasional player</button>
                  </div>
                  <p className="game-seg-cap">next game · {fmtDate(game.nextOccurrence)}</p>
                  <div className="seg" role="group" aria-label="next game">
                    <button type="button" className={nextIn ? "seg-on" : ""}
                      aria-pressed={nextIn} disabled={busy} onClick={() => setNextIn(true)}>i&apos;m in</button>
                    <button type="button" className={!nextIn ? "seg-on seg-on-out" : ""}
                      aria-pressed={!nextIn} disabled={busy} onClick={() => setNextIn(false)}>i&apos;m out</button>
                  </div>
                  <button type="button" className="btn-green game-join" disabled={busy}
                    onClick={() => run(() => joinWeeklyGame(game.gameId, pref === "regular", nextIn))}>
                    {game.onRoster ? "save changes" : "join weekly game"}
                  </button>
                  {game.onRoster && (
                    <button type="button" className="game-leave" disabled={busy}
                      onClick={() => run(() => setRosterMembership(game.gameId, false))}>leave this game</button>
                  )}
                  <p className="game-muted game-in-count">{game.inCount} in for {fmtDate(game.nextOccurrence)}</p>
                </>
              ) : (
                <p className="game-muted">this game is outside your travel radius — widen it in your <a href="/account">account</a> to join.</p>
              )}
              {actionErr && <p className="game-err">{actionErr}</p>}
            </div>

            {game.viewerIsCaptain && (
              <div className="game-captain">
                <p className="game-join-h">captain controls</p>
                {game.status === "active" ? (
                  <div className="seg" role="group" aria-label="captain controls">
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm("call off this week's game?")) run(() => cancelWeek(game.gameId)); }}>cancel this week</button>
                    <button type="button" disabled={busy} onClick={() => askConfirm({ title: "pause this series?", phrase: "retire this game for now", confirmLabel: "pause series", onConfirm: () => run(() => pauseSeries(game.gameId)) })}>pause series</button>
                    <button type="button" className="game-leave" disabled={busy} onClick={() => askConfirm({ title: "retire this series for good? this can't be undone.", phrase: "retire this series for good", confirmLabel: "retire series", onConfirm: () => run(() => retireSeries(game.gameId)) })}>retire series</button>
                  </div>
                ) : (
                  <div className="seg" role="group" aria-label="captain controls">
                    <button type="button" className="btn-green" disabled={busy} onClick={() => { if (window.confirm("resume this series?")) run(() => resumeSeries(game.gameId)); }}>resume series</button>
                    <button type="button" className="game-leave" disabled={busy} onClick={() => askConfirm({ title: "retire this series for good? this can't be undone.", phrase: "retire this series for good", confirmLabel: "retire series", onConfirm: () => run(() => retireSeries(game.gameId)) })}>retire series</button>
                  </div>
                )}
              </div>
            )}

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

      {confirmReq && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmReq(null); }}
          role="alertdialog" aria-modal="true" aria-label="confirm"
          style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(6,10,8,.55)",
            display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div className="game-confirm">
            <p className="game-confirm-title">{confirmReq.title}</p>
            <label className="game-muted" htmlFor="game-confirm-input">
              type <strong>{confirmReq.phrase}</strong> to confirm
            </label>
            <input
              id="game-confirm-input" className="game-confirm-input" autoFocus
              value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmReq.phrase} aria-label="type to confirm"
            />
            <div className="seg" role="group" aria-label="confirm actions">
              <button type="button" onClick={() => setConfirmReq(null)}>cancel</button>
              <button
                type="button" className="btn-green game-confirm-go"
                disabled={typed.trim() !== confirmReq.phrase}
                onClick={() => { const req = confirmReq; setConfirmReq(null); req.onConfirm(); }}
              >{confirmReq.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  ), document.body);
}
