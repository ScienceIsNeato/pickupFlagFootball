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
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [`seed-${tag}-r${i}@example.com`, `Regular ${i + 1}`, jLat, jLng, o.zip],
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
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [`seed-${tag}-i${i}@example.com`, `Local ${i + 1}`, fLat, fLng, o.zip],
    );
    await pool.query(
      `INSERT INTO interest_signals (activity_type_id, user_id, area_id, h3_base, active)
       VALUES ($1, $2, $3, $4, true)`,
      [act.id, u.id, fArea.id, fCell],
    );
  }
  return { lat: o.lat, lng: o.lng, placeText: o.placeText, gameId: String(game.id), areaId: String(area.id) };
}

/** A forming (IN_FORMATION) site mid-attempt (SUGGESTING) with one suggestion
 *  already in — clicking its badge opens the proposed-site popup, and the
 *  returned attemptId lets the formation-FSM e2e expire its windows + add
 *  promises, then drive it with engine ticks. The "not interested" beat uses it
 *  too (it just ignores the attemptId). */
export async function seedFormingAttempt(o: {
  lat: number; lng: number; placeText: string; city: string; zip: string;
}): Promise<{ lat: number; lng: number; placeText: string; areaId: string; attemptId: string }> {
  const DAY = 86_400_000;
  const h3Cell = BigInt("0x" + latLngToCell(o.lat, o.lng, 7)).toString();
  const { rows: [act] } = await pool.query(
    "SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1",
  );
  const { rows: [area] } = await pool.query(
    `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'IN_FORMATION') RETURNING id`,
    [act.id, h3Cell, o.city, o.zip, o.lat, o.lng],
  );
  const tag = String(area.id).slice(0, 8);
  const { rows: [proposer] } = await pool.query(
    `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`seed-${tag}-prop@example.com`, "Pat Proposer", o.lat, o.lng, o.zip],
  );
  const { rows: [attempt] } = await pool.query(
    `INSERT INTO formation_attempts
       (activity_type_id, area_id, attempt_number, status, suggestion_opened_at, suggestion_closes_at)
     VALUES ($1, $2, 1, 'SUGGESTING', now() - interval '1 hour', now() + interval '48 hours') RETURNING id`,
    [act.id, area.id],
  );
  await pool.query(
    `INSERT INTO suggestions
       (attempt_id, user_id, place_text, place_lat, place_lng, proposed_start, recur_dow, recur_time)
     VALUES ($1, $2, $3, $4, $5, $6, 6, '10:00')`,
    [attempt.id, proposer.id, o.placeText, o.lat, o.lng, new Date(Date.now() + 5 * DAY).toISOString()],
  );
  return { lat: o.lat, lng: o.lng, placeText: o.placeText, areaId: String(area.id), attemptId: String(attempt.id) };
}

/** Push the suggestion window into the past so the next tick closes it. */
export async function expireSuggestionWindow(attemptId: string): Promise<void> {
  await pool.query(
    `UPDATE formation_attempts SET suggestion_closes_at = now() - interval '1 minute' WHERE id = $1`,
    [attemptId],
  );
}

/** Push the availability window into the past so the next tick closes it. */
export async function expireAvailabilityWindow(attemptId: string): Promise<void> {
  await pool.query(
    `UPDATE formation_attempts SET availability_closes_at = now() - interval '1 minute' WHERE id = $1`,
    [attemptId],
  );
}

/** Soft-promise the attempt's compiled top option with `n` distinct players —
 *  call AFTER a tick has closed the suggestion window (which compiles options). */
export async function commitToTopOption(attemptId: string, n: number): Promise<void> {
  const { rows: [opt] } = await pool.query(
    `SELECT id FROM formation_options WHERE attempt_id = $1 ORDER BY first_suggested_at, id LIMIT 1`,
    [attemptId],
  );
  if (!opt) throw new Error("no compiled option — tick after the suggestion window closes first");
  const tag = String(attemptId).slice(0, 8);
  for (let i = 0; i < n; i++) {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, 0, 0, '00000', now()) RETURNING id`,
      [`seed-${tag}-promise${i}@example.com`, `Promiser ${i + 1}`],
    );
    await pool.query(
      `INSERT INTO soft_promises (attempt_id, option_id, user_id) VALUES ($1, $2, $3)`,
      [attemptId, opt.id, u.id],
    );
  }
}

/** Whether a game row exists for an area (the formation confirmed). */
export async function areaHasGame(areaId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM games WHERE area_id = $1 LIMIT 1`, [areaId]);
  return rows.length > 0;
}

/** The area's lifecycle status (DORMANT / IN_FORMATION / SCHEDULED / STALLED). */
export async function getAreaStatus(areaId: string): Promise<string> {
  const { rows: [a] } = await pool.query(`SELECT status FROM areas WHERE id = $1`, [areaId]);
  return a?.status ?? "";
}

/** An active standing game whose weekly poll has JUST CLOSED, with `inCount`
 *  roster members defaulting to "in". The next engine tick tallies it →
 *  scheduled (≥ min) or skipped (< min). Returns the occurrence id so steps can
 *  assert on that exact row (robust against any auto-opened occurrence). */
export async function seedWeeklyGameWithClosedPoll(o: {
  lat: number; lng: number; placeText: string; city: string; zip: string; inCount: number;
}): Promise<{ gameId: string; areaId: string; occurrenceId: string; lat: number; lng: number; placeText: string }> {
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
  const { rows: [game] } = await pool.query(
    `INSERT INTO games
       (activity_type_id, area_id, place_text, place_lat, place_lng,
        scheduled_start, status, is_standing, recur_dow, recur_time, color)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', true, 6, '10:00', '#16633a') RETURNING id`,
    [act.id, area.id, o.placeText, o.lat, o.lng, new Date(Date.now() - 28 * DAY).toISOString()],
  );
  const tag = String(game.id).slice(0, 8);
  for (let i = 0; i < o.inCount; i++) {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [`seed-${tag}-in${i}@example.com`, `In ${i + 1}`, o.lat, o.lng, o.zip],
    );
    await pool.query(`INSERT INTO game_roster (game_id, user_id, default_status) VALUES ($1, $2, 'in')`, [game.id, u.id]);
  }
  // A poll that just closed: opened 36h ago, closed a minute ago, kickoff ~12h out.
  const now = Date.now();
  const { rows: [occ] } = await pool.query(
    `INSERT INTO game_occurrences
       (game_id, occurrence_date, status, kickoff_at, poll_opens_at, poll_closes_at, in_count)
     VALUES ($1, $2::date, 'polling', $3, $4, $5, 0) RETURNING id`,
    [game.id, new Date(now + 0.5 * DAY).toISOString(), new Date(now + 0.5 * DAY).toISOString(),
     new Date(now - 1.5 * DAY).toISOString(), new Date(now - 60_000).toISOString()],
  );
  return { gameId: String(game.id), areaId: String(area.id), occurrenceId: String(occ.id), lat: o.lat, lng: o.lng, placeText: o.placeText };
}

/** A specific occurrence's lifecycle status (polling / scheduled / awaiting_game
 *  / skipped / played / …). */
export async function getOccurrenceStatus(occurrenceId: string): Promise<string> {
  const { rows: [o] } = await pool.query(`SELECT status FROM game_occurrences WHERE id = $1`, [occurrenceId]);
  return o?.status ?? "";
}

/** Push an occurrence's kickoff into the past so the next tick marks it played. */
export async function expireOccurrenceKickoff(occurrenceId: string): Promise<void> {
  await pool.query(`UPDATE game_occurrences SET kickoff_at = now() - interval '1 minute' WHERE id = $1`, [occurrenceId]);
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
