"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscape } from "@/lib/useEscape";

type Site = { city: string | null; zip: string | null; status: string | null; captains: string[] };
type Activity = { kind: "propose" | "suggest" | "vote"; byName: string; placeText: string; proposedStart: string; at: string };
type FirstWhen = { firstGameAt: string; recurDow: number | null; recurTime: string | null };
type Data = { site: Site | null; firstPlaceText: string | null; firstWhen: FirstWhen | null; activity: Activity[] };

const DOW_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const STATUS_LABEL: Record<string, string> = {
  SUGGESTING: "collecting suggestions",
  COMPILING: "tallying suggestions",
  AVAILABILITY: "voting open",
  ADJUDICATING: "picking a winner",
};

function whenShort(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
function whenAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function firstLine(placeText: string): string {
  // Suggestions are stored as "street, city zip — notes". Show the street line.
  return placeText.split(" — ")[0];
}
/** "Mondays at 6:30 pm" for a recurring slot, or "Mon Jun 23 at 6:30 pm" for a
 *  one-off. The first-game date is returned separately so the renderer can show
 *  it under the recurring label. */
function fmtWhen(w: FirstWhen): { primary: string; firstDate: string | null } {
  const start = new Date(w.firstGameAt);
  const timeStr = (raw: string | null, fallback: Date): string => {
    const [h, m] = raw ? raw.split(":").map(Number) : [fallback.getHours(), fallback.getMinutes()];
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  };
  const recurring = w.recurDow != null && w.recurDow >= 0 && w.recurDow < 7;
  if (recurring) {
    return {
      primary: `${DOW_PLURAL[w.recurDow!]} at ${timeStr(w.recurTime, start)}`,
      firstDate: `first game ${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
    };
  }
  return {
    primary: `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${timeStr(null, start)}`,
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
  // anchor: the badge's base on the map (x,y) + its rendered pixel height,
  // so we can place this card just above the badge top without hardcoding sizes.
  anchor?: { x: number; y: number; badgeHeight: number } | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<Data | "loading" | "error">("loading");
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEscape(onClose);

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

  // Position the card so its bottom edge sits ~14px above the badge top.
  // Centred horizontally on the badge, clamped to keep the card on-screen.
  useLayoutEffect(() => {
    if (!anchor || !cardRef.current) return;
    const el = cardRef.current;
    const parent = el.parentElement?.getBoundingClientRect();
    const cw = el.offsetWidth, ch = el.offsetHeight;
    const W = parent?.width ?? window.innerWidth;
    const GAP = 14;
    let left = anchor.x - cw / 2;
    left = Math.max(8, Math.min(W - cw - 8, left));
    // anchor.y is the badge ANCHOR (its base on the map); the badge extends up
    // from there by anchor.badgeHeight. Place the card's bottom just above the
    // badge top, with a small gap.
    const badgeTop = anchor.y - anchor.badgeHeight;
    let top = badgeTop - GAP - ch;
    top = Math.max(8, top);
    setPos({ top, left });
  }, [anchor, state]);

  const data = state !== "loading" && state !== "error" ? state : null;
  const site = data?.site ?? null;
  const activity = data?.activity ?? [];
  const firstPlaceText = data?.firstPlaceText ?? null;
  const firstWhen = data?.firstWhen ?? null;
  const when = firstWhen ? fmtWhen(firstWhen) : null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="proposed-details-title"
      style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(6,10,8,.42)" }}
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
        {state !== "loading" && state !== "error" && !site && <p className="game-muted">no proposed site here.</p>}
        {site && (
          <>
            <h2 id="proposed-details-title" className="game-h">proposed game site</h2>
            <dl className="game-dl">
              <dt>where</dt>
              <dd>
                {firstPlaceText
                  ? firstLine(firstPlaceText)
                  : (site.city ?? "this area")}
                {site.zip ? <span className="game-muted"> · {site.zip}</span> : null}
              </dd>
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
              <dd>{(site.status && STATUS_LABEL[site.status]) ?? "forming"}</dd>
              {site.captains.length > 0 && (
                <>
                  <dt>captain{site.captains.length > 1 ? "s" : ""}</dt>
                  <dd>{site.captains.join(", ")}</dd>
                </>
              )}
            </dl>

            <div className="game-collapse" style={{ cursor: "default" }}>activity</div>
            {activity.length > 0 ? (
              <ul className="game-recent">
                {activity.map((a, i) => (
                  <li key={i}>
                    <span>
                      {a.kind === "propose" && <>site proposed by <strong>{a.byName}</strong></>}
                      {a.kind === "suggest" && <><strong>{a.byName}</strong> suggested {firstLine(a.placeText)} · {whenShort(a.proposedStart)}</>}
                      {a.kind === "vote"    && <><strong>{a.byName}</strong> voted for {firstLine(a.placeText)} · {whenShort(a.proposedStart)}</>}
                    </span>
                    <span className="game-muted">{whenAbsolute(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="game-muted">no activity yet — be the first to weigh in.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
