import { Pool } from "pg";
import { latLngToCell } from "h3-js";
import { E2E } from "./env";

const pool = new Pool({ connectionString: E2E.dbUrl });

// Every table EXCEPT the fixed reference data (activity_types, zip_centroids),
// which the seed owns and scenarios never mutate.
const WIPE = [
  "interest_signals",
  "area_captains",
  "game_attendance",
  "game_roster",
  "soft_promises",
  "formation_options",
  "formation_attempts",
  "suggestions",
  "notifications_sent",
  "map_aggregates",
  "games",
  "areas",
  "users",
];

/** Reset the DB to the seeded baseline so every scenario starts identical. */
export async function resetData(): Promise<void> {
  await pool.query(`TRUNCATE ${WIPE.join(", ")} RESTART IDENTITY CASCADE`);
}

/** Delete an account out from under a live session (the "ghost" case). */
export async function deleteUserByEmail(email: string): Promise<void> {
  await pool.query("DELETE FROM users WHERE lower(email) = lower($1)", [email]);
}

/** Mark an account's email confirmed (setup shortcut for scenarios about what a
 *  confirmed player can do — the confirm flow itself is tested separately). */
export async function markEmailVerified(email: string): Promise<void> {
  await pool.query("UPDATE users SET email_verified = now() WHERE lower(email) = lower($1)", [email]);
}

/**
 * Seed an established weekly (standing) game at a venue. Returns the venue point
 * so a test can center the map there and click the badge. The H3 cell must be
 * real so the map renders the badge at the right place (it's drawn at the cell
 * centroid). Eligibility is by distance from the player's home to this venue, so
 * "near home" is joinable and "far" is out of radius.
 */
export async function seedStandingGame(o: {
  lat: number; lng: number; placeText: string; city: string; zip: string;
  regulars?: number;    // background players on the roster → "claimed (in a game)"
  interested?: number;  // background players with interest nearby → "interested player"
}): Promise<{ lat: number; lng: number; placeText: string; gameId: string; areaId: string }> {
  const regulars = o.regulars ?? 15;
  const interested = o.interested ?? 6;
  const DAY = 86_400_000;
  const h3Cell = BigInt("0x" + latLngToCell(o.lat, o.lng, 7)).toString();
  const { rows: [act] } = await pool.query(
    "SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1",
  );
  const { rows: [area] } = await pool.query(
    `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [act.id, h3Cell, o.city, o.zip, o.lat, o.lng],
  );
  // An established game that's been running ~4 weeks: its first occurrence was
  // 4 weeks ago. The weekly slot (recur_dow/time) is what the app projects
  // forward to the next occurrence.
  const anchor = new Date(Date.now() - 28 * DAY).toISOString();
  const { rows: [game] } = await pool.query(
    `INSERT INTO games
       (activity_type_id, area_id, place_text, place_lat, place_lng,
        scheduled_start, status, is_standing, recur_dow, recur_time, color)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', true, 6, '10:00', '#16633a')
     RETURNING id`,
    [act.id, area.id, o.placeText, o.lat, o.lng, anchor],
  );

  // Track record: 3 of the last 4 weeks actually had a game (one week skipped).
  // These played occurrences feed the popup's "recent games · played 3 of …" list.
  for (const [daysAgo, count] of [[6, 13], [13, 15], [20, 12]] as const) {
    const kickoff = new Date(Date.now() - daysAgo * DAY);
    await pool.query(
      `INSERT INTO game_occurrences
         (game_id, occurrence_date, status, kickoff_at, poll_opens_at, poll_closes_at, in_count)
       VALUES ($1, $2::date, 'played', $2, $2, $2, $3)`,
      [game.id, kickoff.toISOString(), count],
    );
  }

  // A real established game has regulars and interested neighbors — without them
  // the map shows a game badge with zero players, which is nonsensical. Seed a
  // realistic backdrop:
  //  - regulars: on the roster, living at the venue's cell → render as "claimed".
  //  - interested: free agents scattered ~16km around the venue (in OTHER cells,
  //    since same-cell interest folds into the game badge) → "interested player".
  const tag = String(game.id).slice(0, 8);

  for (let i = 0; i < regulars; i++) {
    const jLat = o.lat + ((i % 3) - 1) * 0.004;
    const jLng = o.lng + ((i % 5) - 2) * 0.004;
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, email_verified)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [`seed-${tag}-r${i}@example.com`, `Regular ${i + 1}`, jLat, jLng],
    );
    await pool.query(
      `INSERT INTO interest_signals (activity_type_id, user_id, area_id, h3_base, active)
       VALUES ($1, $2, $3, $4, true)`,
      [act.id, u.id, area.id, h3Cell],
    );
    await pool.query(
      `INSERT INTO game_roster (game_id, user_id, default_status) VALUES ($1, $2, 'in')`,
      [game.id, u.id],
    );
  }

  for (let i = 0; i < interested; i++) {
    const angle = (i / Math.max(1, interested)) * 2 * Math.PI;
    const r = 0.16; // ~16km out, inside the 24km radius but in a different cell
    const fLat = o.lat + r * Math.sin(angle);
    const fLng = o.lng + (r * Math.cos(angle)) / Math.cos((o.lat * Math.PI) / 180);
    const fCell = BigInt("0x" + latLngToCell(fLat, fLng, 7)).toString();
    // Their own area at their cell (interest is per-area; one row per user/area).
    const { rows: [fArea] } = await pool.query(
      `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (activity_type_id, h3_cell) DO UPDATE SET center_lat = EXCLUDED.center_lat
       RETURNING id`,
      [act.id, fCell, o.city, o.zip, fLat, fLng],
    );
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, email_verified)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [`seed-${tag}-i${i}@example.com`, `Local ${i + 1}`, fLat, fLng],
    );
    await pool.query(
      `INSERT INTO interest_signals (activity_type_id, user_id, area_id, h3_base, active)
       VALUES ($1, $2, $3, $4, true)`,
      [act.id, u.id, fArea.id, fCell],
    );
  }
  return { lat: o.lat, lng: o.lng, placeText: o.placeText, gameId: String(game.id), areaId: String(area.id) };
}

/** The id of a registered user, by email — to wire up roster/captain/RSVP rows. */
export async function getUserId(email: string): Promise<string> {
  const { rows } = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (!rows[0]) throw new Error(`no user with email ${email}`);
  return String(rows[0].id);
}

/** Make a user a captain of an area (gates the captain controls in the popup). */
export async function seedCaptain(areaId: string, email: string): Promise<void> {
  const userId = await getUserId(email);
  await pool.query(
    "INSERT INTO area_captains (area_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [areaId, userId],
  );
}

/** Put a user on a game's roster (needed before they can RSVP). */
export async function seedRosterMember(gameId: string, email: string, defaultStatus: "in" | "out" = "in"): Promise<void> {
  const userId = await getUserId(email);
  await pool.query(
    `INSERT INTO game_roster (game_id, user_id, default_status) VALUES ($1, $2, $3)
     ON CONFLICT (game_id, user_id) DO UPDATE SET default_status = EXCLUDED.default_status`,
    [gameId, userId, defaultStatus],
  );
}

/** A scheduled (decided-on) upcoming occurrence with a future kickoff, so the
 *  one-click RSVP link is live. Returns the occurrence id for the signed token. */
export async function seedScheduledOccurrence(gameId: string): Promise<string> {
  const DAY = 86_400_000;
  const kickoff = new Date(Date.now() + 2 * DAY); // safely in the future
  const pollOpens = new Date(Date.now() - 1 * DAY);
  const { rows } = await pool.query(
    `INSERT INTO game_occurrences
       (game_id, occurrence_date, status, kickoff_at, poll_opens_at, poll_closes_at, in_count)
     VALUES ($1, $2::date, 'scheduled', $3, $4, $3, 8)
     RETURNING id`,
    [gameId, kickoff.toISOString(), kickoff.toISOString(), pollOpens.toISOString()],
  );
  return String(rows[0].id);
}
