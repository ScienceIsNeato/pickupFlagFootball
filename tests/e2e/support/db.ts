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
}): Promise<{ lat: number; lng: number; placeText: string }> {
  const h3Cell = BigInt("0x" + latLngToCell(o.lat, o.lng, 7)).toString();
  const { rows: [act] } = await pool.query(
    "SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1",
  );
  const { rows: [area] } = await pool.query(
    `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [act.id, h3Cell, o.city, o.zip, o.lat, o.lng],
  );
  // Anchor the standing game's first occurrence a week ago so it's never a
  // hard-coded date that drifts into staleness; the weekly slot (recur_dow/time)
  // is what the app projects forward to the next occurrence.
  const anchor = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await pool.query(
    `INSERT INTO games
       (activity_type_id, area_id, place_text, place_lat, place_lng,
        scheduled_start, status, is_standing, recur_dow, recur_time, color)
     VALUES ($1, $2, $3, $4, $5, $6, 'STANDING', true, 6, '10:00', '#16633a')`,
    [act.id, area.id, o.placeText, o.lat, o.lng, anchor],
  );
  return { lat: o.lat, lng: o.lng, placeText: o.placeText };
}
