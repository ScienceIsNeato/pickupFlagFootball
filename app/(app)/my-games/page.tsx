import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  users, areas, games, gameRoster, interestSignals, areaCaptains,
} from "@/lib/db/schema";
import { MapView } from "@/components/MapView";
import { gameColor } from "@/lib/brand";
import { setAttendance } from "./actions";

export const metadata = { title: "My Games — MIME-FF" };

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
/** The date of the NEXT instance of a standing game (today if today is the recur
 *  weekday, otherwise the next upcoming occurrence) — or the scheduled date for
 *  non-standing games. Named "next" deliberately because past-this-week clicks
 *  return next week's date, not the one that's already happened. */
function nextGameDate(g: { isStanding: boolean; recurDow: number | null; scheduledStart: Date }): Date {
  if (!g.isStanding || g.recurDow == null) return new Date(g.scheduledStart);
  const today = new Date();
  const delta = (g.recurDow - today.getDay() + 7) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
}

export default async function MyGamesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/my-games");
  const me = session.user.id;

  const [u] = await db
    .select({ homeLat: users.homeLat, homeLng: users.homeLng, maxTravelKm: users.maxTravelKm,
              city: users.city, zip: users.zip })
    .from(users).where(eq(users.id, me)).limit(1);

  // The two "mine" inputs: roster (I'm part of) and interest areas (I'm interested in).
  const [rosterRows, interestRows] = await Promise.all([
    db.select({ gameId: gameRoster.gameId }).from(gameRoster).where(eq(gameRoster.userId, me)),
    db.select({ areaId: interestSignals.areaId })
      .from(interestSignals)
      .where(and(eq(interestSignals.userId, me), eq(interestSignals.active, true))),
  ]);
  const onRoster = new Set(rosterRows.map((r) => r.gameId));
  const myAreaIds = interestRows.map((r) => r.areaId);

  // Games I'm rostered on:
  const rosterGames = onRoster.size
    ? await db.select({
        id: games.id, areaId: games.areaId, placeText: games.placeText, status: games.status,
        scheduledStart: games.scheduledStart, isStanding: games.isStanding,
        recurDow: games.recurDow, recurTime: games.recurTime, confirmedCount: games.confirmedCount,
        color: games.color,
        city: areas.displayCity, zip: areas.displayZip,
      }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
        .where(and(inArray(games.id, [...onRoster]), inArray(games.status, ["STAGED", "STANDING"])))
    : [];

  // Games in areas I've shown interest in but am NOT on the roster of:
  const interestGames = myAreaIds.length
    ? await db.select({
        id: games.id, areaId: games.areaId, placeText: games.placeText, status: games.status,
        scheduledStart: games.scheduledStart, isStanding: games.isStanding,
        recurDow: games.recurDow, recurTime: games.recurTime, confirmedCount: games.confirmedCount,
        color: games.color,
        city: areas.displayCity, zip: areas.displayZip,
      }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
        .where(and(inArray(games.areaId, myAreaIds), inArray(games.status, ["STAGED", "STANDING"])))
    : [];
  // De-dupe: a game I'm rostered on is shown under "playing", not "interested".
  const interestOnly = interestGames.filter((g) => !onRoster.has(g.id));

  // Captain badges (for any area we touch).
  const allAreaIds = [...new Set([...rosterGames, ...interestOnly].map((g) => g.areaId))];
  const captainRows = allAreaIds.length
    ? await db.select({ areaId: areaCaptains.areaId, userId: areaCaptains.userId })
        .from(areaCaptains).where(inArray(areaCaptains.areaId, allAreaIds))
    : [];
  const isCaptainArea = new Set(captainRows.filter((r) => r.userId === me).map((r) => r.areaId));

  const center: [number, number] = [u?.homeLng ?? -91.6, u?.homeLat ?? 41.69];
  const home = u?.homeLat != null && u?.homeLng != null
    ? { lat: u.homeLat, lng: u.homeLng, maxTravelKm: u.maxTravelKm, city: u.city ?? null, zip: u.zip ?? null }
    : null;

  const hasAny = rosterGames.length + interestOnly.length > 0;

  return (
    <div className="dash-map">
      <MapView center={center} zoom={9} home={home} mineOnly />
      <aside className="mine-panel">
        <h2 className="mine-h">my games</h2>
        {!hasAny && (
          <p className="mine-empty">
            you&apos;re not part of a game yet and haven&apos;t shown interest in an area with one.{" "}
            <Link href="/play">find a game</Link>.
          </p>
        )}

        {rosterGames.length > 0 && (
          <section className="mine-section">
            <h3 className="mine-sub">i&apos;m playing</h3>
            <ul className="mine-list">
              {rosterGames.map((g) => {
                const next = nextGameDate(g);
                const captain = isCaptainArea.has(g.areaId);
                const color = g.color ?? gameColor(g.id);
                return (
                  <li key={g.id} className="mine-card">
                    <div className="mine-card-top">
                      <span className="mine-dot" style={{ background: color }} aria-hidden />
                      <div className="mine-card-place">
                        <div className="mine-card-name">{g.placeText}</div>
                        <div className="mine-card-meta">
                          {g.city ?? ""}{g.zip ? ` ${g.zip}` : ""} · {weeklyTime(g)}
                        </div>
                      </div>
                      {captain && <span className="mine-tag">captain</span>}
                    </div>
                    <div className="mine-week">
                      <span className="mine-week-label">
                        next game: <strong>{next.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</strong>
                      </span>
                      <form action={setAttendance} className="mine-rsvp">
                        <input type="hidden" name="gameId" value={g.id} />
                        <button type="submit" name="status" value="in" className="rsvp-btn rsvp-in" data-active>i&apos;m in</button>
                        <button type="submit" name="status" value="out" className="rsvp-btn rsvp-out">drop out</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {interestOnly.length > 0 && (
          <section className="mine-section">
            <h3 className="mine-sub">i&apos;m interested</h3>
            <ul className="mine-list">
              {interestOnly.map((g) => {
                const captain = isCaptainArea.has(g.areaId);
                const color = g.color ?? gameColor(g.id);
                return (
                  <li key={g.id} className="mine-card">
                    <div className="mine-card-top">
                      <span className="mine-dot" style={{ background: color }} aria-hidden />
                      <div className="mine-card-place">
                        <div className="mine-card-name">{g.placeText}</div>
                        <div className="mine-card-meta">
                          {g.city ?? ""}{g.zip ? ` ${g.zip}` : ""} · {weeklyTime(g)}
                        </div>
                      </div>
                      {captain && <span className="mine-tag">captain</span>}
                    </div>
                    <div className="mine-week">
                      <span className="mine-week-label">not on the roster</span>
                      <form action={setAttendance} className="mine-rsvp">
                        <input type="hidden" name="gameId" value={g.id} />
                        <button type="submit" name="status" value="in" className="rsvp-btn rsvp-in">join roster</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

