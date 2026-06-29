"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "@/lib/useEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { respondInterest } from "@/app/(app)/play/propose-actions";

type Proposal = {
  attemptId: string; areaId: string; placeText: string;
  proposedStart: string; recurDow: number | null; recurTime: string | null;
  interestClosesAt: string; proposerName: string | null; interestCount: number;
  viewerInterested: boolean | null; captains: string[];
};
type Data = { proposal: Proposal | null };

const DOW_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function firstLine(placeText: string): string {
  // "street, city zip — notes" → show the street line.
  return placeText.split(" — ")[0];
}

/** "2 days left" / "11h left" / "47m left" / "closing now" — time left in the
 *  proposal's interest window. */
function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closing now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "< 1m left";
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)} days left`;
}

/** "Mondays at 6:30 pm" + first-game date for a recurring slot, or a one-off. */
function fmtWhen(p: Proposal): { primary: string; firstDate: string | null } {
  const start = new Date(p.proposedStart);
  const timeStr = (raw: string | null): string => {
    const [h, m] = raw ? raw.split(":").map(Number) : [start.getHours(), start.getMinutes()];
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  };
  const recurring = p.recurDow != null && p.recurDow >= 0 && p.recurDow < 7;
  if (recurring) {
    return {
      primary: `${DOW_PLURAL[p.recurDow!]} at ${timeStr(p.recurTime)}`,
      firstDate: `first game ${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
    };
  }
  return {
    primary: `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${timeStr(null)}`,
    firstDate: null,
  };
}

/** Details for a proposed (forming) game site, opened by clicking its badge.
 *  Positions itself just above (north of) the badge using the `anchor` screen
 *  point; falls back to centered if no anchor is given. */
export function ProposedDetailsModal({
  lat, lng, anchor, onClose,
}: {
  lat: number; lng: number;
  anchor?: { x: number; y: number; badgeHeight: number } | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<Data | "loading" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEscape(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, mounted);

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/proposed?lat=${lat}&lng=${lng}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as Data;
      if (aliveRef.current) setState(d);
    } catch {
      if (aliveRef.current) setState("error");
    }
  }, [lat, lng]);
  useEffect(() => { load(); }, [load]);

  useLayoutEffect(() => {
    if (!anchor || !cardRef.current) return;
    const el = cardRef.current;
    const parent = el.parentElement?.getBoundingClientRect();
    const cw = el.offsetWidth, ch = el.offsetHeight;
    const W = parent?.width ?? window.innerWidth;
    const GAP = 14;
    let left = anchor.x - cw / 2;
    left = Math.max(8, Math.min(W - cw - 8, left));
    const badgeTop = anchor.y - anchor.badgeHeight;
    let top = badgeTop - GAP - ch;
    top = Math.max(8, top);
    setPos({ top, left });
  }, [anchor, state]);

  const data = state !== "loading" && state !== "error" ? state : null;
  const proposal = data?.proposal ?? null;
  const when = proposal ? fmtWhen(proposal) : null;

  async function respond(interested: boolean) {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      await respondInterest(proposal.attemptId, interested);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;
  return createPortal((
    <div
      ref={dialogRef} tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="proposed-details-title"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(6,10,8,.42)" }}
    >
      <div
        ref={cardRef}
        className="game-card"
        style={anchor && pos
          ? { position: "absolute", top: pos.top, left: pos.left, margin: 0 }
          : { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
      >
        <button type="button" className="game-close" onClick={onClose} aria-label="close">×</button>
        {state === "loading" && <p className="game-muted">loading…</p>}
        {state === "error" && <p className="game-muted">couldn&apos;t load this site.</p>}
        {state !== "loading" && state !== "error" && !proposal && <p className="game-muted">no proposed site here.</p>}
        {proposal && (
          <>
            <h2 id="proposed-details-title" className="game-h">proposed game site</h2>
            <dl className="game-dl">
              <dt>where</dt>
              <dd>{firstLine(proposal.placeText)}</dd>
              {when && (
                <>
                  <dt>when</dt>
                  <dd>
                    <strong>{when.primary}</strong>
                    {when.firstDate && <div className="game-muted">{when.firstDate}</div>}
                  </dd>
                </>
              )}
              <dt>status</dt>
              <dd>gathering interest <span className="game-muted">· {timeLeft(proposal.interestClosesAt)}</span></dd>
              <dt>interested</dt>
              <dd>{proposal.interestCount} so far</dd>
              {proposal.captains.length > 0 && (
                <>
                  <dt>captain{proposal.captains.length > 1 ? "s" : ""}</dt>
                  <dd>{proposal.captains.join(", ")}</dd>
                </>
              )}
            </dl>

            {/* In / out on THIS proposal (a different nearby proposal can still
                reach you). "in" counts toward forming + rosters you if it forms. */}
            <p className="game-join-h">{proposal.viewerInterested === true ? "you're in" : "want in?"}</p>
            <div className="seg" role="group" aria-label="interest">
              <button type="button" className={proposal.viewerInterested === true ? "seg-on" : ""}
                aria-pressed={proposal.viewerInterested === true} disabled={busy} onClick={() => respond(true)}>i&apos;m interested</button>
              <button type="button" className={proposal.viewerInterested === false ? "seg-on seg-on-out" : ""}
                aria-pressed={proposal.viewerInterested === false} disabled={busy} onClick={() => respond(false)}>not interested</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
