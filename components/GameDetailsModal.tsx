"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "@/lib/useEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { joinWeeklyGame, setRosterMembership } from "@/app/(app)/play/game-actions";
import { pauseSeries, resumeSeries, retireSeries, cancelWeek, stepDownAsCaptain, volunteerAsCaptain, setMinPlayers } from "@/app/(app)/play/captain-actions";

type GameInfo = {
  gameId: string;
  placeText: string;
  placeLat: number | null; placeLng: number | null;
  scheduledStart: string;
  isStanding: boolean; recurDow: number | null; recurTime: string | null;
  confirmedCount: number; status: string;
  // Per-site "minimum expected players": the captain's override (null = unset)
  // and the effective value the weekly poll uses (override or area default).
  minPlayers: number | null; minPlayersEffective: number;
  pausedUntil: string | null; pauseNote: string | null;
  city: string | null; zip: string | null;
  captains: string[];
  viewerIsCaptain: boolean;
  eligible: boolean; onRoster: boolean;
  myDefault: "in" | "out" | null;
  myRsvp: "in" | "out" | null;
  rosterCount: number; inCount: number;
  nextOccurrence: string;
  canRetire: boolean; retireBlockedReason: string | null;
};
type Week = { weekStart: string; played: boolean; count: number; status?: string | null; cancelNote?: string | null };
type PlayedGame = { date: string; inCount: number };
type OffWeek = { date: string; status: string; note: string | null }; // status: "cancelled" | "skipped"

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

type ConfirmReq =
  | { kind: "phrase"; title: string; phrase: string; confirmLabel: string; onConfirm: () => void }
  | { kind: "pause"; title: string; confirmLabel: string; onConfirm: (resumeDate: string, note: string) => void }
  | { kind: "note"; title: string; confirmLabel: string; placeholder: string; onConfirm: (note: string) => void };

/** Details for an existing game, opened by clicking its flags on the map. */
export function GameDetailsModal({ lat, lng, onClose, onChanged }: { lat: number; lng: number; onClose: () => void; onChanged?: () => void }) {
  const [state, setState] = useState<{ game: GameInfo | null; weeks: Week[]; playedHistory: PlayedGame[]; offThisWeek: OffWeek | null } | "loading" | "error">("loading");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");
  // Confirm gate for destructive captain actions. "phrase" = type-to-confirm
  // (retire); "pause" = collect an expected resume date + a required note.
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [typed, setTyped] = useState("");
  const [resumeDate, setResumeDate] = useState("");
  const [pauseNote, setPauseNote] = useState("");
  const [pref, setPref] = useState<"regular" | "occasional">("regular");
  const [nextIn, setNextIn] = useState(true);
  // Captain's "minimum expected players" input — seeded from the effective value
  // on load so editing starts from what's actually in force.
  const [minInput, setMinInput] = useState("");
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
      const d = (await r.json()) as { game: GameInfo | null; weeks?: Week[]; playedHistory?: PlayedGame[]; offThisWeek?: OffWeek | null };
      setState({ game: d.game, weeks: d.weeks ?? [], playedHistory: d.playedHistory ?? [], offThisWeek: d.offThisWeek ?? null });
    } catch {
      setState("error");
    }
  }, [lat, lng]);

  useEffect(() => { load(); }, [load]);

  const game = state !== "loading" && state !== "error" ? state.game : null;
  const weeks = state !== "loading" && state !== "error" ? state.weeks : [];
  const playedHistory = state !== "loading" && state !== "error" ? state.playedHistory : [];
  const offThisWeek = state !== "loading" && state !== "error" ? state.offThisWeek : null;
  const playedCount = weeks.filter((w) => w.played).length;
  const retired = game?.status === "retired";
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
    // Start the min-players input from the effective value in force.
    setMinInput(String(game.minPlayersEffective));
  }, [game?.gameId, game?.onRoster, game?.myDefault, game?.myRsvp, game?.minPlayersEffective]);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setActionErr("");
    try {
      const res = await action();
      if (!res.ok) { setActionErr(res.error ?? "something went wrong"); return; }
      await load();
      // A captain action (retire/pause/…) or join/leave changes the map too —
      // refresh clusters so the badge (retired greying, ring, tallies) doesn't
      // lag the modal until the next pan/zoom.
      onChanged?.();
    } catch {
      setActionErr("something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // A member's segment toggles persist immediately — no separate "save".
  // joinWeeklyGame is idempotent: it updates the regular/occasional default +
  // the next-game RSVP. Optimistic, reverting on failure.
  async function persist(p: "regular" | "occasional", inVal: boolean) {
    if (!game || busy) return;
    const prevP = pref, prevIn = nextIn;
    setPref(p); setNextIn(inVal);
    setBusy(true); setActionErr("");
    try {
      const res = await joinWeeklyGame(game.gameId, p === "regular", inVal);
      if (!res.ok) { setActionErr(res.error ?? "something went wrong"); setPref(prevP); setNextIn(prevIn); return; }
      await load();
      onChanged?.();
    } catch {
      setActionErr("something went wrong"); setPref(prevP); setNextIn(prevIn);
    } finally {
      setBusy(false);
    }
  }

  // A not-yet-member stages their choices locally and commits with the explicit
  // "join game" button; a member's taps persist immediately.
  const choosePref = (p: "regular" | "occasional") => { if (game?.onRoster) persist(p, nextIn); else setPref(p); };
  const chooseNext = (inVal: boolean) => { if (game?.onRoster) persist(pref, inVal); else setNextIn(inVal); };

  async function joinNow() {
    if (!game || busy) return;
    setBusy(true); setActionErr("");
    try {
      const res = await joinWeeklyGame(game.gameId, pref === "regular", nextIn);
      if (!res.ok) { setActionErr(res.error ?? "something went wrong"); return; }
      await load();
      onChanged?.();
    } catch {
      setActionErr("something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function askConfirm(req: ConfirmReq) {
    setTyped(""); setResumeDate(""); setPauseNote("");
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
      {/* While a type-to-confirm dialog is open, the card is inert so Tab/clicks
          can't reach the obscured controls behind it — focus stays in the dialog. */}
      <div className="game-card" inert={confirmReq ? true : undefined}>
        <button type="button" className="game-close" onClick={onClose} aria-label="close">×</button>
        {state === "loading" && <p className="game-muted">loading…</p>}
        {state === "error" && <p className="game-muted">couldn&apos;t load this game.</p>}
        {state !== "loading" && state !== "error" && !game && <p className="game-muted">no game here yet.</p>}
        {game && (
          <>
            <h2 id="game-details-title" className="game-h">{game.isStanding ? "standing game" : "game on"}</h2>
            {retired && <div className="game-retired" role="status">retired</div>}
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
                  <dd className="game-captain-dd">
                    <span>{game.captains.join(", ")}</span>
                    {game.viewerIsCaptain && <span className="game-you">(you)</span>}
                  </dd>
                </>
              )}
            </dl>

            {!retired && offThisWeek && (
              offThisWeek.status === "skipped" ? (
                <div className="game-cancelled game-cancelled--skipped" role="status">
                  <p className="game-cancelled-h">this week ({fmtDate(offThisWeek.date)}) is skipped</p>
                  <p className="game-cancelled-note">not enough players said they&apos;re in</p>
                </div>
              ) : (
                <div className="game-cancelled" role="status">
                  <p className="game-cancelled-h">this week ({fmtDate(offThisWeek.date)}) is called off</p>
                  {offThisWeek.note && <p className="game-cancelled-note">“{offThisWeek.note}”</p>}
                </div>
              )
            )}

            {!retired && (
            <div className="game-join-box">
              {game.status === "paused" ? (
                <div className="game-paused">
                  <p className="game-paused-h">
                    paused by the captain{game.pausedUntil ? <> · back by <strong>{fmtDate(game.pausedUntil)}</strong></> : null}
                  </p>
                  {game.pauseNote && <p className="game-paused-note">“{game.pauseNote}”</p>}
                </div>
              ) : game.onRoster || (game.eligible && !game.viewerIsCaptain) ? (
                <>
                  {/* Players (and playing captains, who are on the roster) join / manage RSVP.
                      Members are already in — the heading + button say so, not "join". */}
                  {/* Members are already in (toggles save on tap); a not-yet-member
                      joins the moment they pick — the heading says which. */}
                  <p className="game-join-h">{game.onRoster ? "you've found your weekly game!" : "join weekly game"}</p>
                  <div className="seg" role="group" aria-label="how often you'll play">
                    <button type="button" className={pref === "regular" ? "seg-on" : ""}
                      aria-pressed={pref === "regular"} disabled={busy} onClick={() => choosePref("regular")}>regular player</button>
                    <button type="button" className={pref === "occasional" ? "seg-on" : ""}
                      aria-pressed={pref === "occasional"} disabled={busy} onClick={() => choosePref("occasional")}>occasional player</button>
                  </div>
                  <p className="game-seg-cap">next game · {fmtDate(game.nextOccurrence)}</p>
                  <div className="seg" role="group" aria-label="next game">
                    <button type="button" className={nextIn ? "seg-on" : ""}
                      aria-pressed={nextIn} disabled={busy} onClick={() => chooseNext(true)}>i&apos;m in</button>
                    <button type="button" className={!nextIn ? "seg-on seg-on-out" : ""}
                      aria-pressed={!nextIn} disabled={busy} onClick={() => chooseNext(false)}>i&apos;m out</button>
                  </div>
                  {game.onRoster && (
                    <button type="button" className="game-leave" disabled={busy}
                      onClick={() => run(() => setRosterMembership(game.gameId, false))}>leave this game</button>
                  )}
                  <p className="game-muted game-in-count">{game.inCount} in for {fmtDate(game.nextOccurrence)}</p>
                  {/* A not-yet-member's toggles stage their choice; this commits it. */}
                  {!game.onRoster && (
                    <button type="button" className="game-join-cta" disabled={busy} onClick={joinNow}>join game</button>
                  )}
                </>
              ) : game.viewerIsCaptain ? (
                // Captain who isn't a roster player: no "join" affordance, just the status.
                <>
                  <p className="game-seg-cap">next game · {fmtDate(game.nextOccurrence)}</p>
                  <p className="game-muted game-in-count">{game.inCount} in for {fmtDate(game.nextOccurrence)}</p>
                </>
              ) : (
                <p className="game-muted">this game is outside your travel radius - widen it in your <a href="/account">account</a> to join.</p>
              )}
              {actionErr && <p className="game-err">{actionErr}</p>}
            </div>
            )}

            {!retired && game.viewerIsCaptain && (
              <div className="game-captain">
                <p className="game-join-h">captain controls</p>
                {game.status === "active" ? (
                  <div className="seg" role="group" aria-label="captain controls">
                    <button type="button" disabled={busy} onClick={() => askConfirm({ kind: "note", title: "call off this week's game?", confirmLabel: "cancel this week", placeholder: "field's flooded — back next week", onConfirm: (note) => run(() => cancelWeek(game.gameId, note)) })}>cancel this week</button>
                    <button type="button" disabled={busy} onClick={() => askConfirm({ kind: "pause", title: "pause this series?", confirmLabel: "pause series", onConfirm: (d, n) => run(() => pauseSeries(game.gameId, d, n)) })}>pause series</button>
                    <button type="button" className="game-leave" disabled={busy || !game.canRetire} onClick={() => askConfirm({ kind: "phrase", title: "retire this series for good? this can't be undone.", phrase: "retire this series for good", confirmLabel: "retire series", onConfirm: () => run(() => retireSeries(game.gameId)) })}>retire series</button>
                  </div>
                ) : (
                  <div className="seg" role="group" aria-label="captain controls">
                    <button type="button" className="btn-green" disabled={busy} onClick={() => { if (window.confirm("resume this series?")) run(() => resumeSeries(game.gameId)); }}>resume series</button>
                    <button type="button" className="game-leave" disabled={busy || !game.canRetire} onClick={() => askConfirm({ kind: "phrase", title: "retire this series for good? this can't be undone.", phrase: "retire this series for good", confirmLabel: "retire series", onConfirm: () => run(() => retireSeries(game.gameId)) })}>retire series</button>
                  </div>
                )}
                {/* Why retire is disabled — a live game can't be killed off early. */}
                {!game.canRetire && game.retireBlockedReason && (
                  <p className="game-muted game-retire-hint">{game.retireBlockedReason}</p>
                )}
                {/* Per-site minimum expected players — the bar the weekly poll uses
                    to decide whether that week's game runs. Captain-set, since they
                    know their own walk-on / no-show balance. */}
                <div className="game-minplayers">
                  <label className="game-minplayers-label" htmlFor="minplayers">minimum expected players</label>
                  <div className="game-minplayers-row">
                    {(() => {
                      // Save only a valid whole number in range — never truncate a
                      // decimal (5.5 → 5) silently past the server's integer check.
                      const parsed = Number(minInput);
                      const valid = minInput.trim() !== "" && Number.isInteger(parsed)
                        && parsed >= 2 && parsed <= 60;
                      const unchanged = parsed === game.minPlayersEffective;
                      return (
                        <>
                          <input id="minplayers" type="number" inputMode="numeric" min={2} max={60} step={1}
                            className="game-minplayers-input" value={minInput} disabled={busy}
                            onChange={(e) => setMinInput(e.target.value)} />
                          <button type="button" disabled={busy || !valid || unchanged}
                            onClick={() => run(() => setMinPlayers(game.gameId, parsed))}>save</button>
                        </>
                      );
                    })()}
                    {game.minPlayers !== null && (
                      <button type="button" className="game-minplayers-reset" disabled={busy}
                        onClick={() => run(() => setMinPlayers(game.gameId, null))}>use area default</button>
                    )}
                  </div>
                  <p className="game-muted game-minplayers-hint">
                    a week only runs when at least this many say they&apos;re in.{" "}
                    {game.minPlayers === null ? "using the area default." : "set for this site."}
                  </p>
                </div>
                {/* Relinquish the role (distinct from retiring the whole series). */}
                <button type="button" className="game-leave" disabled={busy}
                  onClick={() => { if (window.confirm("step down as captain of this game?")) run(() => stepDownAsCaptain(game.gameId)); }}>
                  step down as captain
                </button>
              </div>
            )}

            {/* Anyone (confirmed, not already a captain) can volunteer — emphasized
                when the game has no captain at all. Not for retired series. */}
            {!retired && !game.viewerIsCaptain && (
              <div className="game-captain">
                {game.captains.length === 0 ? (
                  <>
                    <p className="game-join-h">this game has no captain</p>
                    <p className="game-muted game-volunteer-note">
                      a captain runs the weekly poll and keeps the game going. want to take it on?
                    </p>
                  </>
                ) : (
                  <p className="game-join-h">help run this game</p>
                )}
                <button type="button" className="btn-green game-volunteer" disabled={busy}
                  onClick={() => run(() => volunteerAsCaptain(game.gameId))}>
                  volunteer as captain
                </button>
              </div>
            )}

            {retired ? (
              // Retired: history is the whole point of the view — show it expanded,
              // the last games actually played at this site with their dates.
              <div className="game-history">
                <p className="game-join-h">games played here</p>
                {playedHistory.length === 0 ? (
                  <p className="game-muted">no games on record.</p>
                ) : (
                  <ul className="game-recent">
                    {playedHistory.map((h, i) => (
                      <li key={i}>
                        <span>{new Date(`${h.date}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                        <span className="game-played">✓ {h.inCount} in</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
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
                          : w.status === "cancelled"
                          ? <span className="game-called-off">✕ called off{w.cancelNote ? ` · ${w.cancelNote}` : ""}</span>
                          : w.status === "skipped"
                          ? <span className="game-muted">— skipped · low turnout</span>
                          : <span className="game-muted">— no game</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
            {confirmReq.kind === "phrase" ? (
              <>
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
              </>
            ) : confirmReq.kind === "note" ? (
              <>
                <label className="game-muted" htmlFor="game-note-input">why (shown to players)</label>
                <textarea
                  id="game-note-input" className="game-confirm-input game-pause-note" rows={2} autoFocus
                  value={pauseNote} onChange={(e) => setPauseNote(e.target.value)}
                  placeholder={confirmReq.placeholder} aria-label="why"
                />
                <div className="seg" role="group" aria-label="confirm actions">
                  <button type="button" onClick={() => setConfirmReq(null)}>cancel</button>
                  <button
                    type="button" className="btn-green game-confirm-go"
                    disabled={!pauseNote.trim()}
                    onClick={() => { const req = confirmReq; setConfirmReq(null); req.onConfirm(pauseNote.trim()); }}
                  >{confirmReq.confirmLabel}</button>
                </div>
              </>
            ) : (
              <>
                <label className="game-muted" htmlFor="game-pause-date">back by</label>
                <input
                  id="game-pause-date" className="game-confirm-input" type="date" autoFocus
                  value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} aria-label="back by"
                />
                <label className="game-muted" htmlFor="game-pause-note">why (shown to players)</label>
                <textarea
                  id="game-pause-note" className="game-confirm-input game-pause-note" rows={2}
                  value={pauseNote} onChange={(e) => setPauseNote(e.target.value)}
                  placeholder="summer break - back in september" aria-label="why"
                />
                <p className="game-muted game-pause-hint">no resume date in mind? retire the series instead.</p>
                <div className="seg" role="group" aria-label="confirm actions">
                  <button type="button" onClick={() => setConfirmReq(null)}>cancel</button>
                  <button
                    type="button" className="btn-green game-confirm-go"
                    disabled={!resumeDate || !pauseNote.trim()}
                    onClick={() => { const req = confirmReq; setConfirmReq(null); req.onConfirm(resumeDate, pauseNote.trim()); }}
                  >{confirmReq.confirmLabel}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  ), document.body);
}
