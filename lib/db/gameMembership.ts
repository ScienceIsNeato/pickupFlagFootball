import { sql } from "drizzle-orm";
import { db } from "./index";
import { nextOccurrenceYMD } from "@/lib/datetime";

export type GameOccurrenceInputs = {
  id: string;
  isStanding: boolean;
  recurDow: number | null;
  scheduledStart: string;
};

/** The game's occurrence inputs if it's active, regardless of distance — for
 *  RSVP, which only requires roster membership (checked by the caller). */
export async function activeGame(gameId: string): Promise<GameOccurrenceInputs | null> {
  const rows = (await db.execute(sql`
    select id, is_standing as "isStanding", recur_dow as "recurDow",
           scheduled_start as "scheduledStart"
    from games where id = ${gameId} and status in ('STAGED', 'STANDING') limit 1`)).rows as GameOccurrenceInputs[];
  return rows[0] ?? null;
}

/** The game (occurrence inputs) if it's active AND the user's travel radius
 *  reaches its area — the rule that gates joining. Matches the engine's
 *  catchment haversine (R=6371). Null if out of range or inactive. */
export async function reachableActiveGame(userId: string, gameId: string): Promise<GameOccurrenceInputs | null> {
  const rows = (await db.execute(sql`
    select g.id, g.is_standing as "isStanding", g.recur_dow as "recurDow",
           g.scheduled_start as "scheduledStart"
    from games g
    join areas a on a.id = g.area_id
    join users u on u.id = ${userId}
    where g.id = ${gameId}
      and g.status in ('STAGED', 'STANDING')
      and u.home_lat is not null and u.home_lng is not null
      and 6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(u.home_lat - a.center_lat) / 2), 2)
        + cos(radians(a.center_lat)) * cos(radians(u.home_lat))
        * power(sin(radians(u.home_lng - a.center_lng) / 2), 2)
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

/** The current user's standing on a game + this-occurrence tallies, for the
 *  details popup and any RSVP UI. */
export async function gameMembership(
  userId: string, game: GameOccurrenceInputs, now: Date,
): Promise<Membership> {
  const occ = nextOccurrenceYMD(game, now);
  const [m] = (await db.execute(sql`
    select
      (select default_status from game_roster r where r.game_id = ${game.id} and r.user_id = ${userId}) as my_default,
      (select status from game_attendance a
         where a.game_id = ${game.id} and a.user_id = ${userId} and a.occurrence_date = ${occ}) as my_rsvp,
      (select count(*)::int from game_roster r where r.game_id = ${game.id}) as roster_count,
      (select count(*)::int from game_attendance a
         where a.game_id = ${game.id} and a.occurrence_date = ${occ} and a.status = 'in') as in_count
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
