import { sql } from "drizzle-orm";
import { db } from "./index";
import { nextOccurrenceYMD, kickoffAtFor, toYMD } from "@/lib/datetime";

export type GameOccurrenceInputs = {
  id: string;
  isStanding: boolean;
  recurDow: number | null;
  recurTime: string | null;
  scheduledStart: string;
  timezone: string; // the area's IANA zone — kickoffAtFor composes local kickoff
};

/** The game's occurrence inputs if it's active, regardless of distance — for
 *  RSVP, which only requires roster membership (checked by the caller). */
export async function activeGame(gameId: string): Promise<GameOccurrenceInputs | null> {
  const rows = (await db.execute(sql`
    select g.id, g.is_standing as "isStanding", g.recur_dow as "recurDow",
           g.recur_time as "recurTime", g.scheduled_start as "scheduledStart", a.timezone
    from games g join areas a on a.id = g.area_id
    where g.id = ${gameId} and g.status = 'active' limit 1`)).rows as GameOccurrenceInputs[];
  return rows[0] ?? null;
}

/** The game (occurrence inputs) if it's active AND the user's travel radius
 *  reaches its area — the rule that gates joining. Matches the engine's
 *  catchment haversine (R=6371). Null if out of range or inactive. */
export async function reachableActiveGame(userId: string, gameId: string): Promise<GameOccurrenceInputs | null> {
  const rows = (await db.execute(sql`
    select g.id, g.is_standing as "isStanding", g.recur_dow as "recurDow",
           g.recur_time as "recurTime", g.scheduled_start as "scheduledStart", a.timezone
    from games g
    join areas a on a.id = g.area_id
    join users u on u.id = ${userId}
    where g.id = ${gameId}
      and g.status = 'active'
      and u.home_lat is not null and u.home_lng is not null
      -- measure to the game's actual venue (how the map/API locate it), falling
      -- back to the area centroid only when no venue point is stored
      and 6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(u.home_lat - coalesce(g.place_lat, a.center_lat)) / 2), 2)
        + cos(radians(coalesce(g.place_lat, a.center_lat))) * cos(radians(u.home_lat))
        * power(sin(radians(u.home_lng - coalesce(g.place_lng, a.center_lng)) / 2), 2)
      ))) <= u.max_travel_km
    limit 1`)).rows as GameOccurrenceInputs[];
  return rows[0] ?? null;
}

export type Membership = {
  occurrence: string;            // next occurrence date (YYYY-MM-DD)
  onRoster: boolean;             // is the user a regular on this game
  myDefault: "in" | "out" | null; // per-site default ("usually come"/"won't"); null if not on roster
  myRsvp: "in" | "out" | null;   // their RSVP for the next occurrence
  rosterCount: number;           // regulars
  inCount: number;               // RSVP'd "in" for the next occurrence
};

/** The next recurrence date that's actually playable — skipping weeks the captain
 *  called off or the poll skipped. Shared by the popup and the join/RSVP writes so
 *  they never target an off week. */
export async function nextPlayableOccurrence(game: GameOccurrenceInputs, now: Date): Promise<string> {
  const offRows = (await db.execute(sql`
    select occurrence_date::text as d from game_occurrences
    where game_id = ${game.id} and status in ('cancelled', 'skipped', 'played')
      and occurrence_date >= ${toYMD(now)}::date`)).rows as Array<{ d: string }>;
  const off = new Set(offRows.map((r) => r.d));
  // A week is also "off" once its kickoff has passed — the next playable game is
  // the following week, not a date that already started.
  const started = (ymd: string) => kickoffAtFor(game, ymd) <= now;
  let occ = nextOccurrenceYMD(game, now);
  for (let guard = 0; (off.has(occ) || started(occ)) && guard < 26; guard++) {
    const after = new Date(`${occ}T12:00:00`);
    after.setDate(after.getDate() + 1);
    const nextOcc = nextOccurrenceYMD(game, after);
    if (nextOcc === occ) break; // one-off game — no further recurrence
    occ = nextOcc;
  }
  return occ;
}

/** The current user's standing on a game + this-occurrence tallies, for the
 *  details popup and any RSVP UI. */
export async function gameMembership(
  userId: string, game: GameOccurrenceInputs, now: Date,
): Promise<Membership> {
  const occ = await nextPlayableOccurrence(game, now);
  const [m] = (await db.execute(sql`
    select
      (select default_status from game_roster r where r.game_id = ${game.id} and r.user_id = ${userId}) as my_default,
      (select status from game_attendance a
         where a.game_id = ${game.id} and a.user_id = ${userId} and a.occurrence_date = ${occ}) as my_rsvp,
      (select count(*)::int from game_roster r where r.game_id = ${game.id}) as roster_count,
      (select count(*)::int from (
         -- roster members: explicit override wins, else their site default
         select r.user_id
           from game_roster r
           left join game_attendance a
             on a.game_id = r.game_id and a.user_id = r.user_id and a.occurrence_date = ${occ}
           where r.game_id = ${game.id} and coalesce(a.status, r.default_status) = 'in'
         union
         -- drop-ins: explicit "in" with no roster row
         select a.user_id
           from game_attendance a
           where a.game_id = ${game.id} and a.occurrence_date = ${occ} and a.status = 'in'
             and not exists (select 1 from game_roster r where r.game_id = a.game_id and r.user_id = a.user_id)
       ) eff) as in_count
  `)).rows as Array<{ my_default: string | null; my_rsvp: string | null; roster_count: number; in_count: number }>;
  return {
    occurrence: occ,
    onRoster: m?.my_default != null,
    myDefault: (m?.my_default as "in" | "out" | null) ?? null,
    myRsvp: (m?.my_rsvp as "in" | "out" | null) ?? null,
    rosterCount: Number(m?.roster_count ?? 0),
    inCount: Number(m?.in_count ?? 0),
  };
}
