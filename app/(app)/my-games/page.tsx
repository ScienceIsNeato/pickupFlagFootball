import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { users, areas, games, gameRoster, gameAttendance, gameOccurrences } from "@/lib/db/schema";
import { MapView } from "@/components/MapView";
import { gameColor } from "@/lib/brand";
import { occurrenceDatesInRange, toYMD } from "@/lib/datetime";
import { setOccurrenceRsvp, setSiteDefault } from "./actions";

export const metadata = { title: "Upcoming Games — MIME-FF" };

const DAY = 86_400_000;
const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function fmtTime(t?: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
function weeklyTime(g: { isStanding: boolean; recurDow: number | null; recurTime: string | null; scheduledStart: Date }): string {
  if (g.isStanding && g.recurDow != null && g.recurTime) return `${DOW[g.recurDow]} at ${fmtTime(g.recurTime)}`;
  return new Date(g.scheduledStart).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
}
function fmtDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default async function UpcomingGamesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/my-games");
  const me = session.user.id;
  // Open to any signed-in user — no roster yet just shows the empty state.

  const now = new Date();
  // Only load attendance within the displayed window (last 8 / next 6 weeks) so
  // the queries don't grow unbounded as weekly rows accumulate.
  const windowStart = toYMD(new Date(now.getTime() - 56 * DAY));
  const windowEnd = toYMD(new Date(now.getTime() + 42 * DAY));

  const [u] = await db
    .select({ homeLat: users.homeLat, homeLng: users.homeLng, maxTravelKm: users.maxTravelKm,
              city: users.city, zip: users.zip })
    .from(users).where(eq(users.id, me)).limit(1);

  // Sites I've joined (roster) + my per-site default ("usually come"/"won't").
  const rosterRows = await db.select({ gameId: gameRoster.gameId, defaultStatus: gameRoster.defaultStatus })
    .from(gameRoster).where(eq(gameRoster.userId, me));
  const rosterIds = rosterRows.map((r) => r.gameId);
  const defaultByGame = new Map(rosterRows.map((r) => [r.gameId, r.defaultStatus]));

  const rosterGames = rosterIds.length
    ? await db.select({
        id: games.id, areaId: games.areaId, placeText: games.placeText, status: games.status,
        scheduledStart: games.scheduledStart, isStanding: games.isStanding,
        recurDow: games.recurDow, recurTime: games.recurTime, color: games.color,
        city: areas.displayCity, zip: areas.displayZip,
      }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
        .where(and(inArray(games.id, rosterIds), inArray(games.status, ["active", "paused"])))
    : [];

  // My RSVP overrides (covers upcoming + past), and per-occurrence "in" headcounts.
  const myAtt = rosterIds.length
    ? await db.select({ gameId: gameAttendance.gameId, date: gameAttendance.occurrenceDate, status: gameAttendance.status })
        .from(gameAttendance).where(and(
          eq(gameAttendance.userId, me), inArray(gameAttendance.gameId, rosterIds),
          gte(gameAttendance.occurrenceDate, windowStart), lte(gameAttendance.occurrenceDate, windowEnd),
        ))
    : [];
  const myByKey = new Map(myAtt.map((a) => [`${a.gameId}|${a.date}`, a.status]));

  const headRows = rosterIds.length
    ? await db.select({ gameId: gameAttendance.gameId, date: gameAttendance.occurrenceDate, c: sql<number>`count(*)::int` })
        .from(gameAttendance)
        .where(and(
          eq(gameAttendance.status, "in"), inArray(gameAttendance.gameId, rosterIds),
          gte(gameAttendance.occurrenceDate, windowStart), lte(gameAttendance.occurrenceDate, windowEnd),
        ))
        .groupBy(gameAttendance.gameId, gameAttendance.occurrenceDate)
    : [];
  const headByKey = new Map(headRows.map((r) => [`${r.gameId}|${r.date}`, Number(r.c)]));

  // Occurrence outcomes are the source of truth for "played" — a skipped/cancelled
  // week isn't played even if leftover RSVPs would clear the headcount.
  const occRows = rosterIds.length
    ? await db.select({ gameId: gameOccurrences.gameId, date: gameOccurrences.occurrenceDate, status: gameOccurrences.status })
        .from(gameOccurrences).where(and(
          inArray(gameOccurrences.gameId, rosterIds),
          gte(gameOccurrences.occurrenceDate, windowStart), lte(gameOccurrences.occurrenceDate, windowEnd),
        ))
    : [];
  const occByKey = new Map(occRows.map((o) => [`${o.gameId}|${o.date}`, o.status]));

  // Upcoming: next 6 weeks of occurrences across joined sites, chronological.
  const isOff = (g: { id: string }, date: string) => {
    const s = occByKey.get(`${g.id}|${date}`);
    // called off / poll skipped / already played → not an upcoming game
    return s === "cancelled" || s === "skipped" || s === "played";
  };
  // Once kickoff passes the week is no longer RSVP-able (setOccurrenceRsvp rejects
  // it), so drop it from the list rather than show controls that fail.
  const started = (g: { recurTime: string | null; scheduledStart: Date }, date: string) =>
    new Date(`${date}T${g.recurTime ?? new Date(g.scheduledStart).toTimeString().slice(0, 8)}`) <= now;
  const upcoming = rosterGames
    .filter((g) => g.status === "active") // paused series have no upcoming games to RSVP to
    .flatMap((g) => occurrenceDatesInRange(g, now, new Date(now.getTime() + 42 * DAY)).map((date) => ({ g, date })))
    .filter(({ g, date }) => !isOff(g, date) && !started(g, date))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Past: last 8 weeks, most recent first.
  const past = rosterGames
    .flatMap((g) => occurrenceDatesInRange(g, new Date(now.getTime() - 56 * DAY), new Date(now.getTime() - DAY)).map((date) => ({ g, date })))
    .sort((a, b) => b.date.localeCompare(a.date));

  const center: [number, number] = [u?.homeLng ?? -91.6, u?.homeLat ?? 41.69];
  const home = u?.homeLat != null && u?.homeLng != null
    ? { lat: u.homeLat, lng: u.homeLng, maxTravelKm: u.maxTravelKm, city: u.city ?? null, zip: u.zip ?? null }
    : null;

  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} home={home} mineOnly />

      {/* ── left: upcoming ─────────────────────────────────────────────── */}
      <aside className="mine-panel">
        <h2 className="mine-h">upcoming games</h2>
        {rosterGames.length === 0 ? (
          <p className="mine-empty">
            you haven&apos;t joined a game yet. <Link href="/play">find one on the map</Link> and tap
            &ldquo;join weekly game&rdquo;.
          </p>
        ) : (
          <>
            <section className="mine-section">
              <h3 className="mine-sub">your sites</h3>
              <ul className="mine-list">
                {rosterGames.map((g) => {
                  const def = defaultByGame.get(g.id) ?? "in";
                  const color = g.color ?? gameColor(g.id);
                  return (
                    <li key={g.id} className="mine-card">
                      <div className="mine-card-top">
                        <span className="mine-dot" style={{ background: color }} aria-hidden />
                        <div className="mine-card-place">
                          <div className="mine-card-name">{g.placeText}</div>
                          <div className="mine-card-meta">{g.city ?? ""}{g.zip ? ` ${g.zip}` : ""} · {weeklyTime(g)}</div>
                        </div>
                      </div>
                      <form action={setSiteDefault} className="mine-pref">
                        <input type="hidden" name="gameId" value={g.id} />
                        <span className="mine-pref-label">by default i&apos;ll</span>
                        <button type="submit" name="default" value="in" className="rsvp-btn rsvp-in" {...(def === "in" ? { "data-active": true } : {})}>usually come</button>
                        <button type="submit" name="default" value="out" className="rsvp-btn rsvp-out" {...(def === "out" ? { "data-active": true } : {})}>usually won&apos;t</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="mine-section">
              <h3 className="mine-sub">upcoming</h3>
              {upcoming.length === 0 ? <p className="mine-empty">no games scheduled in the next 6 weeks.</p> : (
                <ul className="mine-list">
                  {upcoming.map(({ g, date }) => {
                    const key = `${g.id}|${date}`;
                    const override = myByKey.get(key);
                    const eff = override ?? defaultByGame.get(g.id) ?? "in";
                    return (
                      <li key={key} className="mine-occ">
                        <div className="mine-occ-when">
                          <strong>{fmtDate(date)}</strong>
                          <span className="mine-occ-site">{g.placeText}</span>
                        </div>
                        <form action={setOccurrenceRsvp} className="mine-rsvp">
                          <input type="hidden" name="gameId" value={g.id} />
                          <input type="hidden" name="date" value={date} />
                          <button type="submit" name="status" value="in" className="rsvp-btn rsvp-in" {...(eff === "in" ? { "data-active": true } : {})}>in</button>
                          <button type="submit" name="status" value="out" className="rsvp-btn rsvp-out" {...(eff === "out" ? { "data-active": true } : {})}>out</button>
                          {!override && <span className="mine-occ-def">default</span>}
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </aside>

      {/* ── right: past ────────────────────────────────────────────────── */}
      <aside className="mine-panel mine-right">
        <h2 className="mine-h">past games</h2>
        {rosterGames.length === 0 ? (
          <p className="mine-empty">once you join a game, what happened at your sites shows up here.</p>
        ) : past.length === 0 ? (
          <p className="mine-empty">no games at your sites in the last 8 weeks.</p>
        ) : (
          <ul className="mine-list">
            {past.map(({ g, date }) => {
              const key = `${g.id}|${date}`;
              const head = headByKey.get(key) ?? 0;
              // Occurrence status is the single source of truth for "played" — same
              // as the map popup, so the two views never disagree.
              const played = occByKey.get(key) === "played";
              // Past attendance is read from frozen rows only — never today's
              // default, which would rewrite history when a member changes their
              // pref. The tick freeze materializes a row for everyone who was in.
              const youIn = myByKey.get(key) === "in";
              return (
                <li key={key} className="mine-occ">
                  <div className="mine-occ-when">
                    <strong>{fmtDate(date)}</strong>
                    <span className="mine-occ-site">{g.placeText}</span>
                  </div>
                  <div className="mine-past-result">
                    {played
                      ? <span className="game-played">✓ played · {head} in</span>
                      : <span className="mine-occ-def">— no game</span>}
                    {played && (youIn
                      ? <span className="mine-you mine-you-in">you played</span>
                      : <span className="mine-you">you sat out</span>)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
