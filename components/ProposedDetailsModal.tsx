"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Site = { city: string | null; zip: string | null; status: string | null; captains: string[] };
type Activity = { kind: "propose" | "suggest" | "vote"; byName: string; placeText: string; proposedStart: string; at: string };
type Data = { site: Site | null; firstPlaceText: string | null; activity: Activity[] };

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

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
            <h2 className="game-h">proposed game site</h2>
            <dl className="game-dl">
              <dt>where</dt>
              <dd>
                {firstPlaceText
                  ? firstLine(firstPlaceText)
                  : (site.city ?? "this area")}
                {site.zip ? <span className="game-muted"> · {site.zip}</span> : null}
              </dd>
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
