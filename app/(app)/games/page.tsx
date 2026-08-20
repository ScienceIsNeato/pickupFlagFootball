import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { games, areas, activityTypes, users } from "@/lib/db/schema";
import { haversineKm, kmToMiles } from "@/lib/geo";
import { skin } from "@/lib/skin";

export const metadata = { title: "Games Near You - MIME-FF" };

// The map's game badges are canvas-drawn, which a screen reader or keyboard
// can never reach (audit M1). This list is the equivalent DOM path: every
// active game as a real link to its /game/[id] page (redesign decision B2),
// nearest first when the viewer has a home on file.

const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export default async function GamesListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/games");

  const [u] = await db.select({ homeLat: users.homeLat, homeLng: users.homeLng })
    .from(users).where(eq(users.id, session.user.id)).limit(1);

  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, skin.slug)).limit(1);
  const rows = act ? await db.select({
    id: games.id, placeText: games.placeText, status: games.status,
    recurDow: games.recurDow, recurTime: games.recurTime,
    placeLat: games.placeLat, placeLng: games.placeLng,
    city: areas.displayCity, centerLat: areas.centerLat, centerLng: areas.centerLng,
  }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
    .where(and(eq(games.activityTypeId, act.id), inArray(games.status, ["active", "paused"]))) : [];

  const list = rows.map((g) => {
    const lat = g.placeLat ?? g.centerLat, lng = g.placeLng ?? g.centerLng;
    const miles = u?.homeLat != null && u?.homeLng != null
      ? Math.round(kmToMiles(haversineKm(u.homeLat, u.homeLng, lat, lng)))
      : null;
    return { ...g, miles };
  }).sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9));

  return (
    <main className="game-page games-list">
      <Link href="/play" className="back">&larr; back to the map</Link>
      <h1 className="reg-h">games near you</h1>
      {list.length === 0 ? (
        <p className="game-muted">
          no standing games yet. the map is where one starts —{" "}
          <Link href="/play">propose a spot and a weekly time</Link>.
        </p>
      ) : (
        <ul className="games-list-ul">
          {list.map((g) => (
            <li key={g.id}>
              <Link href={`/game/${g.id}`} className="games-list-item">
                <span className="games-list-name">
                  {g.placeText.split(" — ")[0]}
                  {g.city ? <span className="game-muted"> · {g.city}</span> : null}
                </span>
                <span className="games-list-meta">
                  {g.recurDow != null && g.recurTime
                    ? `${DOW[g.recurDow]} at ${fmtTime(g.recurTime)}`
                    : "schedule inside"}
                  {g.status === "paused" ? " · paused" : ""}
                  {g.miles != null ? ` · ${g.miles} mi` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
