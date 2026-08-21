"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { respondInterest, withdrawProposal } from "@/app/(app)/play/propose-actions";

import { ChatPanel } from "@/components/ChatPanel";
import { CardTabs } from "@/components/CardTabs";
type Proposal = {
  attemptId: string; areaId: string; placeText: string;
  proposedStart: string; recurDow: number | null; recurTime: string | null;
  interestClosesAt: string; proposerName: string | null; interestCount: number;
  viewerInterested: boolean | null; viewerIsProposer: boolean; noticeCount: number;
  captains: string[];
};
type Data = { proposal: Proposal | null };

const DOW_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function firstLine(placeText: string): string {
  // "street, city zip — notes" → show the street line.
  return placeText.split(" — ")[0];
}

/** Friendly text for a respondInterest failure reason, so a rejected tap (window
 *  closed, unverified, out of range, …) shows up instead of silently reloading. */
function respondReason(reason: string): string {
  return ({
    closed: "this proposal already closed.",
    withdrawn: "the proposer withdrew this one.",
    notyours: "only the proposer can withdraw this.",
    unverified: "confirm your email before joining in.",
    outofrange: "this game is outside your travel area.",
    nolocation: "set your home location to join in.",
    missing: "this proposal is no longer available.",
    unauth: "sign in to respond.",
  } as Record<string, string>)[reason] ?? "couldn't save that - try again.";
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

/** Details for a proposed (forming) game site — the body of the /proposed page
 *  (redesign decision B2: pages replaced the map's anchored popovers). Keyed by
 *  the site's coordinates, matching /api/proposed. */
export function ProposedCard({ lat, lng }: { lat: number; lng: number }) {
  const [state, setState] = useState<Data | "loading" | "error">("loading");
  // Chat is a tab here for the same reason as the game card: the popup already
  // scrolls, so a nested message list would leave the composer unanchored.
  const [tab, setTab] = useState<"details" | "chat">("details");
  const [busy, setBusy] = useState(false);
  const [respondErr, setRespondErr] = useState("");
  // Two-step withdraw (C1): the quiet link arms the confirm block; nothing
  // happens until "yes, withdraw it". No modal — the card itself is the page.
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const router = useRouter();
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

  const data = state !== "loading" && state !== "error" ? state : null;
  const proposal = data?.proposal ?? null;
  const when = proposal ? fmtWhen(proposal) : null;

  async function respond(interested: boolean) {
    if (!proposal || busy) return;
    setBusy(true); setRespondErr("");
    try {
      const res = await respondInterest(proposal.attemptId, interested);
      if (!res.ok) { setRespondErr(respondReason(res.reason)); return; }
      await load();
      // The HUD's own tally for this exact proposal just changed — tell it to
      // re-read now instead of waiting for its next periodic poll.
      window.dispatchEvent(new Event("mime:hud-stale"));
    } catch {
      setRespondErr("something went wrong - try again.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!proposal || busy) return;
    setBusy(true); setRespondErr("");
    try {
      const res = await withdrawProposal(proposal.attemptId);
      if (!res.ok) { setRespondErr(respondReason(res.reason)); return; }
      // The badge this page was reached from no longer exists — back to the map,
      // and tell the HUD its forming tally is stale.
      window.dispatchEvent(new Event("mime:hud-stale"));
      router.push("/play");
    } catch {
      setRespondErr("something went wrong - try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
      <div className="game-card game-card--page">
        {state === "loading" && <p className="game-muted">loading…</p>}
        {state === "error" && <p className="game-muted">couldn&apos;t load this site.</p>}
        {state !== "loading" && state !== "error" && !proposal && <p className="game-muted">no proposed site here.</p>}
        {proposal && (
          <>
            <h2 id="proposed-details-title" className="game-h">proposed game site</h2>
            <CardTabs idBase="proposed" active={tab} onChange={setTab}
              tabs={[{ id: "details", label: "details" }, { id: "chat", label: "chat" }] as const} />
            <div role="tabpanel" id="proposed-panel-details"
              aria-labelledby="proposed-tab-details" hidden={tab !== "details"}>
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
            {respondErr && <p className="game-muted" role="alert">{respondErr}</p>}

            {/* Proposer-only withdraw (C1). A quiet link, not a button row —
                withdrawing is the rare correction path, not a peer of in/out. */}
            {proposal.viewerIsProposer && !confirmWithdraw && (
              <p className="proposed-withdraw">
                <button type="button" className="auth-link" disabled={busy}
                  onClick={async () => {
                    // Refresh noticeCount at decision time - the card may have
                    // sat open while people unsubscribed or changed their answer,
                    // and the confirm copy promises the server's real recipient
                    // count (which the send re-computes regardless).
                    setBusy(true);
                    try { await load(); } finally { setBusy(false); }
                    setConfirmWithdraw(true);
                  }}>withdraw this proposal…</button>
              </p>
            )}
            {proposal.viewerIsProposer && confirmWithdraw && (
              <div className="proposed-withdraw-confirm" role="group" aria-label="confirm withdraw">
                <p>
                  {/* noticeCount is the server's actual recipient set for the
                      withdrawal note, so this promise is exact - not a guess
                      derived from the interest tally. */}
                  {proposal.noticeCount > 0
                    ? `withdraw this proposal? the ${proposal.noticeCount === 1 ? "person" : `${proposal.noticeCount} people`} who said they're in will get a note.`
                    : "withdraw this proposal? it just disappears - nobody needs a note."}
                  {" "}you can propose a corrected one right after.
                </p>
                <div className="proposed-withdraw-actions">
                  <button type="button" className="btn-danger" disabled={busy} onClick={withdraw}>
                    {busy ? "withdrawing…" : "yes, withdraw it"}
                  </button>
                  <button type="button" className="auth-link" disabled={busy}
                    onClick={() => setConfirmWithdraw(false)}>keep it</button>
                </div>
              </div>
            )}
            </div>
            {/* hidden, not unmounted: switching tabs must not destroy a
                half-typed draft in the composer (audit M24). */}
            <div role="tabpanel" id="proposed-panel-chat" aria-labelledby="proposed-tab-chat"
              hidden={tab !== "chat"}>
              <ChatPanel attemptId={proposal.attemptId} isProposal active={tab === "chat"} />
            </div>
          </>
        )}
      </div>
  );
}
