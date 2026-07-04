"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AreaScenario } from "@/lib/mime/areaScenario";
import { buildShareTemplates } from "@/lib/shareTemplates";
import { skin } from "@/lib/skin";

type Place = { city: string | null; zip: string | null } | null;

/** Bottom-right map HUD: autodetects which of a handful of real states the
 *  viewer's own area is in and gives concrete next-step advice — never a bare
 *  "propose a game" to an area with nobody in it. Every number shown comes
 *  from the server's live scenario detection, not hardcoded copy. */
export function MapHud({ scenario: initialScenario, place: initialPlace }: { scenario: AreaScenario; place: Place }) {
  // Server-rendered props are only the first paint. The viewer's own propose/
  // join/interest actions (and anyone else's, in the same area) can change the
  // scenario without a navigation, so poll the same detection server-side runs
  // and adopt whatever it reports — a stale "you're the first one here" after
  // the viewer just proposed a game would be actively misleading. The 15s
  // interval alone is a safety net for changes made by OTHER people in the
  // area; the viewer's OWN mutations (propose, join/leave, interest response)
  // dispatch "mime:hud-stale" from MapView/ProposedDetailsModal so this reads
  // immediately instead of waiting out the interval.
  const [scenario, setScenario] = useState(initialScenario);
  const [place, setPlace] = useState(initialPlace);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/hud", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as { scenario: AreaScenario | null; place: Place };
        // scenario: null means "no area yet" (an invariant violation this
        // component doesn't expect while mounted) — keep showing the last
        // known-good state rather than guess, same as a transient fetch error.
        if (data.scenario) { setScenario(data.scenario); setPlace(data.place); }
      } catch {
        // offline/transient — keep showing the last known-good scenario.
      }
    }
    // Fire once immediately — the interval alone would leave a 15s gap right
    // after mount (e.g. a soft client-side navigation reusing a stale prop)
    // before the first live read.
    void poll();
    const onStale = () => { void poll(); };
    window.addEventListener("mime:hud-stale", onStale);
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; window.removeEventListener("mime:hud-stale", onStale); clearInterval(id); };
  }, []);

  const where = place?.city ? `${place.city}${place.zip ? ` (${place.zip})` : ""}` : "your area";
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [closesText, setClosesText] = useState("closes soon");

  useEffect(() => {
    if (scenario.kind !== "open-proposal") return;
    const closesAt = new Date(scenario.closesAt).getTime();
    const compute = () => {
      const ms = closesAt - Date.now();
      // The attempt can still be OPEN in the DB after its deadline (the gap
      // before the next cron tick / event-driven resolve) — say so plainly
      // rather than "closes within the hour", which implies time still left.
      if (ms <= 0) { setClosesText("closing any moment"); return; }
      // Ceil, not round — 1.4h left must never read as "within the hour" (an
      // underestimate that could rush someone past a deadline that hasn't hit yet).
      const hours = Math.ceil(ms / 3_600_000);
      setClosesText(hours <= 1 ? "closes within the hour" : `closes in ~${hours}h`);
    };
    compute();
    // Keep it fresh in a long-lived tab, not just at mount.
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [scenario]);

  const [url, setUrl] = useState("");
  useEffect(() => { setUrl(window.location.origin); }, []);

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((v) => (v === i ? null : v)), 1800);
    } catch {
      // clipboard permission denied or unavailable — nothing to do, the text is
      // still visible for a manual select-and-copy.
    }
  }

  let headline: string;
  let body: string;
  switch (scenario.kind) {
    case "games":
      headline = scenario.count === 1 ? "there's a game near you" : `${scenario.count} games near you`;
      body = scenario.count === 1
        ? `${scenario.placeText ?? "a standing game"} already runs weekly here — click its badge on the map to join.`
        : "click any game badge on the map to see details and join.";
      break;
    case "open-proposal":
      headline = "a game's been proposed";
      body = `${scenario.placeText} — ${scenario.interestedCount}/${scenario.pMin} people are in, ${closesText}. click its badge to say you're in.`;
      break;
    case "ambient-interest":
      headline = `${scenario.totalCount} interested in ${where}`;
      body = `${scenario.othersCount} other${scenario.othersCount === 1 ? "" : "s"} nearby want to play. know a good spot and time? right-click the map to propose it — or invite more people below.`;
      break;
    case "alone":
      headline = "you're the first one here";
      body = "a game needs a few neighbors to get moving. proposing now would reach no one — share this with people nearby first.";
      break;
  }

  const templates = buildShareTemplates(scenario, skin.activity, place, url || "https://pickupflagfootball.com");

  return (
    <div className="map-hud">
      <p className="map-hud-h">{headline}</p>
      <p className="map-hud-body">{body}</p>
      {scenario.kind === "ambient-interest" || scenario.kind === "alone" ? (
        <div className="map-hud-share">
          <p className="map-hud-share-label">share this to grow {where}</p>
          {templates.map((t, i) => (
            <button key={t.label} type="button" className="map-hud-copy" onClick={() => copy(t.text, i)}>
              {copiedIdx === i ? "copied ✓" : `copy ${t.label} post`}
            </button>
          ))}
        </div>
      ) : (
        <Link href="/my-games" className="map-hud-link">my games &rarr;</Link>
      )}
    </div>
  );
}
