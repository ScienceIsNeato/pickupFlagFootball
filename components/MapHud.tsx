"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AreaScenario } from "@/lib/mime/areaScenario";
import { buildShareTemplates } from "@/lib/shareTemplates";
import { skin } from "@/lib/skin";

type Place = { city: string | null; zip: string | null } | null;
type Faq = { q: string; a: string };

/** Every question someone in this exact state would ask, answered with the
 *  area's live numbers — the whole "how does this even work" story, scoped to
 *  where the viewer actually is in it. Answers describe the real engine
 *  behavior (proposal emails, the pMin threshold, weekly polls), so if that
 *  behavior changes this copy must change with it. */
function buildFaq(scenario: AreaScenario, activity: string): Faq[] {
  switch (scenario.kind) {
    case "alone":
      return [
        { q: "what am i looking at?",
          a: `the map, centered on your neighborhood. right now you're the only person here who's said they want a ${activity} game - so there's nothing to join yet. you're the first, and that's exactly how these get started.` },
        { q: "how do games actually form?",
          a: `you propose a spot, day, and time. everyone nearby on the map gets an email asking if they're in - once ${scenario.pMin} say yes, it's a real weekly game. nobody has to organize anything after that.` },
        { q: "why shouldn't i propose right now?",
          a: "a proposal only reaches people already on the map who are in range of your spot. right now that's next to nobody - it would sit unseen and quietly fail." },
        { q: "so what do i actually do?",
          a: "get a few neighbors on the map first. the buttons below give you a ready-made post - drop it in a group chat, a local subreddit, a flyer, wherever your neighbors actually are." },
        { q: "what do people have to do to join?",
          a: "name, email, and a rough location - about 30 seconds, no app to install. everyone on this map is a real person who did exactly that." },
      ];
    case "ambient-interest":
      return [
        { q: "what am i looking at?",
          a: `your neighborhood, with everyone who wants a ${activity} game here on the map. ${scenario.totalCount} of you are interested, but nobody's picked a spot and time yet - real demand, just no game on the calendar.` },
        { q: `who are these ${scenario.totalCount} people?`,
          a: `neighbors who put themselves on the map and can travel to a game here. nothing on this map is seeded or fake - every flag is a real person.` },
        { q: "what happens if i propose?",
          a: `everyone in range of your spot - about ${scenario.totalCount} people right now - gets an email with the day and time, asking if they're in. once ${scenario.pMin} say yes before the window closes, the game is on - and it repeats weekly from there.` },
        { q: "what if not enough say yes?",
          a: "the proposal quietly fails and nothing bad happens - no game, no spam. anyone can propose again, usually once the area has grown a bit." },
        { q: "how do i propose?",
          a: `long-press the map on your phone (or right-click on a computer) where you'd want to play. good spots: a park or field people already know, a weekend morning.` },
      ];
    case "open-proposal":
      return [
        { q: "what am i looking at?",
          a: `someone's put an actual game on the table near you - a place, a day, a time - and people are saying whether they're in. ${scenario.interestedCount} of the ${scenario.pMin} it needs have said yes so far. get it there and it becomes a real weekly game.` },
        { q: "how do i say i'm in?",
          a: `click the proposed-site badge on the map and hit "i'm interested". that's the whole job - no commitment beyond showing up.` },
        { q: `what happens at ${scenario.pMin}?`,
          a: `the game is scheduled: everyone who said yes gets a game-on email with the spot and time, and it repeats weekly from there.` },
        { q: "what if it falls short?",
          a: "when the window closes short, the proposal fails quietly - no game, no drama. anyone can propose again, and your interest stays on the map either way." },
        { q: "can i still bring people in?",
          a: `yes - anyone who joins the map near here before the window closes can tap in on this exact proposal.` },
      ];
    case "games":
      return [
        { q: "what am i looking at?",
          a: scenario.count === 1
            ? `a standing ${activity} game that already runs near you, week after week. nothing to start or organize - just join the roster and show up.`
            : `${scenario.count} standing ${activity} games that already run near you on a regular schedule. join whichever fits - nothing to organize, just show up.` },
        { q: "how do i join?",
          a: "click the game badge on the map and say you're in - you're on the roster from then on." },
        { q: "what's the weekly rhythm?",
          a: `before each game, everyone on the roster gets a quick poll email. enough yeses and the week is on; too few and that week is skipped - no group-chat wrangling.` },
        { q: "what if i can't make a week?",
          a: "answer the poll honestly and sit it out. skipping a week never drops you from the roster." },
        { q: `want a second ${activity} game here?`,
          a: `long-press the map (or right-click on a computer) to propose another spot or time - areas can hold more than one game.` },
      ];
  }
}

/** Map HUD (top center): autodetects which of a handful of real states the
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
  // The interval, the immediate mount-fire, and "mime:hud-stale" can all kick
  // off overlapping fetches — a slower one landing after a newer one must not
  // overwrite it with older data. seqRef tags each poll's request; a response
  // only applies if no newer poll has started since it began.
  const seqRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const seq = ++seqRef.current;
      try {
        const r = await fetch("/api/hud", { cache: "no-store" });
        if (!r.ok || cancelled || seq !== seqRef.current) return;
        const data = (await r.json()) as { scenario: AreaScenario | null; place: Place };
        if (cancelled || seq !== seqRef.current) return;
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
  // Collapsed by default. On desktop the HUD is a left rail and CSS always shows
  // the panel regardless of this flag; on a phone it's a bottom sheet that stays
  // collapsed to a headline peek so the map's center badges (which sit right
  // where this panel would otherwise cover) stay tappable — tap the peek to open.
  const [expanded, setExpanded] = useState(false);
  // Only a phone actually collapses (CSS shows the panel on desktop regardless),
  // so the peek carries toggle a11y semantics only when it's a real toggle —
  // otherwise a screen reader would announce the always-visible desktop panel as
  // collapsed (WCAG 4.1.2). SSR-safe: starts false, corrected after mount.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
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
      body = `${scenario.othersCount} other${scenario.othersCount === 1 ? "" : "s"} nearby want to play. know a good spot and time? long-press the map (or right-click on a computer) to propose it — or invite more people below.`;
      break;
    case "alone":
      headline = "you're the first one here";
      // "next to no one", not "no one": the count is measured from the area's
      // center, and a real proposal reaches whoever's in range of the exact
      // spot chosen — which can pick up a stray neighbor the estimate misses.
      body = "a game needs a few neighbors to get moving. proposing now would reach next to no one — share this with people nearby first.";
      break;
  }

  const templates = buildShareTemplates(
    scenario, { name: skin.activity, emoji: skin.emoji }, place, url || "https://pickupflagfootball.com",
  );
  const faq = buildFaq(scenario, skin.activity);

  return (
    <div className="map-hud" data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        className="map-hud-peek"
        aria-expanded={isMobile ? expanded : undefined}
        aria-controls={isMobile ? "map-hud-panel" : undefined}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="map-hud-h">{headline}</span>
        <span className="map-hud-caret" aria-hidden="true">▸</span>
      </button>
      <div className="map-hud-panel" id="map-hud-panel">
        <p className="map-hud-body">{body}</p>
        <div className="map-hud-faq">
          {faq.map((f) => (
            <details key={f.q} className="map-hud-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
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
    </div>
  );
}
