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
  "attempt_interest",
  "formation_attempts",
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

/** Create a minimal verified user and put them on a game's roster — a teammate
 *  who isn't the browser's session user (for notify-the-roster scenarios). */
export async function seedRosterMemberUser(gameId: string, email: string, name: string): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, display_name, zip, home_lat, home_lng, email_verified)
     VALUES ($1, $2, '78701', 30.27, -97.74, now())
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [email, name],
  );
  await pool.query(
    `INSERT INTO game_roster (game_id, user_id, default_status) VALUES ($1, $2, 'in')
     ON CONFLICT (game_id, user_id) DO NOTHING`,
    [gameId, rows[0].id],
  );
}

/** Opt a user out of their own area (the email "not interested in this site"
 *  case) so the account-page re-entry UI has something to show. */
export async function seedAreaOptout(email: string): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO area_optouts (area_id, user_id)
       SELECT s.area_id, s.user_id FROM interest_signals s
       JOIN users u ON u.id = s.user_id
       WHERE lower(u.email) = lower($1) LIMIT 1
     ON CONFLICT DO NOTHING RETURNING area_id`,
    [email],
  );
  if (!rows[0]) throw new Error(`no interest signal to opt out for ${email}`);
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
  dead?: boolean;       // no game played within the retire window → retire-eligible
}): Promise<{ lat: number; lng: number; placeText: string; gameId: string; areaId: string }> {
  const regulars = o.regulars ?? 15;
  const interested = o.interested ?? 6;
  const DAY = 86_400_000;
  const h3Cell = BigInt("0x" + latLngToCell(o.lat, o.lng, 7)).toString();
  const { rows: [act] } = await pool.query(
    "SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1",
  );
  const { rows: [area] } = await pool.query(
    `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED') RETURNING id`,
    [act.id, h3Cell, o.city, o.zip, o.lat, o.lng],
  );
  // An established game that's been running ~4 weeks: its first occurrence was
  // 4 weeks ago. The weekly slot (recur_dow/time) is what the app projects
  // forward to the next occurrence. `dead` games are older (60d) with no recent
  // play, so they pass the retire eligibility window.
  const anchor = new Date(Date.now() - (o.dead ? 60 : 28) * DAY).toISOString();
  const { rows: [game] } = await pool.query(
    `INSERT INTO games
       (activity_type_id, area_id, place_text, place_lat, place_lng,
        scheduled_start, status, is_standing, recur_dow, recur_time, color)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', true, 6, '10:00', '#16633a')
     RETURNING id`,
    [act.id, area.id, o.placeText, o.lat, o.lng, anchor],
  );

  // Track record of played weeks (feeds the popup's "recent games" list). A live
  // game played recently (6/13/20d ago); a dead game's last games are all >4
  // weeks back (35/42/49d ago) so nothing falls inside the retire window.
  const playedWeeks: ReadonlyArray<readonly [number, number]> = o.dead
    ? [[35, 13], [42, 15], [49, 12]]
    : [[6, 13], [13, 15], [20, 12]];
  for (const [daysAgo, count] of playedWeeks) {
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

/** A live proposal (OPEN attempt) by a stand-in proposer (not the test user) —
 *  for flows that need a proposed site near the viewer without driving the propose
 *  action. The proposer is auto-interested + captain. Pass `notifyEmail` to also
 *  enqueue a real GAME_PROPOSED ask to that user (flushed on the next tick), the
 *  way the live proposeGame would — so the recipient's inbox carries the proposal
 *  email with its one-click Interested / Not-Interested links. */
export async function seedFormingAttempt(o: {
  lat: number; lng: number; placeText: string; city: string; zip: string;
  notifyEmail?: string;
}): Promise<{ lat: number; lng: number; placeText: string; areaId: string; attemptId: string }> {
  const DAY = 86_400_000;
  const h3Cell = BigInt("0x" + latLngToCell(o.lat, o.lng, 7)).toString();
  const { rows: [act] } = await pool.query("SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1");
  // Find-or-create the venue's area: registration may already own this cell (when
  // the recipient registered first), so a plain INSERT would hit the unique cell.
  let { rows: [area] } = await pool.query(
    "SELECT id FROM areas WHERE activity_type_id = $1 AND h3_cell = $2 LIMIT 1", [act.id, h3Cell],
  );
  if (!area) {
    ({ rows: [area] } = await pool.query(
      `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'DORMANT') RETURNING id`,
      [act.id, h3Cell, o.city, o.zip, o.lat, o.lng],
    ));
  }
  const tag = String(area.id).slice(0, 8);
  const { rows: [proposer] } = await pool.query(
    `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`seed-${tag}-prop@example.com`, "Pat Proposer", o.lat, o.lng, o.zip],
  );
  const { rows: [attempt] } = await pool.query(
    `INSERT INTO formation_attempts
       (activity_type_id, area_id, attempt_number, status, proposer_id, place_text, place_lat, place_lng,
        proposed_start, recur_dow, recur_time, interest_closes_at)
     VALUES ($1, $2, 1, 'OPEN', $3, $4, $5, $6, $7, 6, '10:00', now() + interval '48 hours') RETURNING id`,
    [act.id, area.id, proposer.id, o.placeText, o.lat, o.lng, new Date(Date.now() + 5 * DAY).toISOString()],
  );
  await pool.query("INSERT INTO attempt_interest (attempt_id, user_id, interested) VALUES ($1, $2, true)", [attempt.id, proposer.id]);
  await pool.query("INSERT INTO area_captains (area_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [area.id, proposer.id]);
  // A pending GAME_PROPOSED ask to the named recipient — the next tick flushes it
  // into their inbox with the proposal's details + Interested/Not-Interested links.
  if (o.notifyEmail) {
    const uid = await getUserId(o.notifyEmail);
    await pool.query(
      `INSERT INTO notifications_sent (user_id, attempt_id, kind, channel)
       VALUES ($1, $2, 'GAME_PROPOSED', 'email') ON CONFLICT DO NOTHING`,
      [uid, attempt.id],
    );
  }
  return { lat: o.lat, lng: o.lng, placeText: o.placeText, areaId: String(area.id), attemptId: String(attempt.id) };
}

/** The test user proposes a game — mirrors the proposeGame action: find-or-create
 *  the area, open an OPEN attempt with the proposal, seed a neighbour cohort + the
 *  pending GAME_PROPOSED emails, make the proposer captain + auto-interested. */
export async function proposeAsUser(email: string, o: {
  lat: number; lng: number; placeText: string; city: string; zip: string;
}): Promise<{ lat: number; lng: number; placeText: string; areaId: string; attemptId: string }> {
  const DAY = 86_400_000;
  const userId = await getUserId(email);
  const h3Cell = BigInt("0x" + latLngToCell(o.lat, o.lng, 7)).toString();
  const { rows: [act] } = await pool.query("SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1");
  // Find-or-create the area for the venue's cell (registration may already own it).
  let { rows: [area] } = await pool.query(
    "SELECT id FROM areas WHERE activity_type_id = $1 AND h3_cell = $2 LIMIT 1", [act.id, h3Cell],
  );
  if (!area) {
    ({ rows: [area] } = await pool.query(
      `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'DORMANT') RETURNING id`,
      [act.id, h3Cell, o.city, o.zip, o.lat, o.lng],
    ));
  }
  // A few nearby "neighbours" as the courting cohort, so GAME_PROPOSED / STALLED
  // emails have real recipients — like the cohort the real proposeGame snapshots.
  const tag = String(area.id).slice(0, 8);
  const cohort: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { rows: [nb] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [`seed-${tag}-neighbor${i}@example.com`, `Neighbor ${i + 1}`, o.lat, o.lng, o.zip],
    );
    cohort.push(String(nb.id));
  }
  const { rows: [next] } = await pool.query(
    "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM formation_attempts WHERE area_id = $1", [area.id],
  );
  const { rows: [attempt] } = await pool.query(
    `INSERT INTO formation_attempts
       (activity_type_id, area_id, attempt_number, status, proposer_id, place_text, place_lat, place_lng,
        proposed_start, recur_dow, recur_time, cohort_user_ids, interest_closes_at)
     VALUES ($1, $2, $3, 'OPEN', $4, $5, $6, $7, $8, 6, '10:00', $9, now() + interval '48 hours') RETURNING id`,
    [act.id, area.id, next.n, userId, o.placeText, o.lat, o.lng, new Date(Date.now() + 5 * DAY).toISOString(), cohort],
  );
  // Proposer is in by definition + becomes the captain.
  await pool.query("INSERT INTO attempt_interest (attempt_id, user_id, interested) VALUES ($1, $2, true) ON CONFLICT DO NOTHING", [attempt.id, userId]);
  await pool.query("INSERT INTO area_captains (area_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [area.id, userId]);
  // GAME_PROPOSED to the cohort — pending until a tick flushes it.
  for (const u of cohort) {
    await pool.query(
      `INSERT INTO notifications_sent (user_id, attempt_id, kind, channel)
       VALUES ($1, $2, 'GAME_PROPOSED', 'email') ON CONFLICT DO NOTHING`,
      [u, attempt.id],
    );
  }
  return { lat: o.lat, lng: o.lng, placeText: o.placeText, areaId: String(area.id), attemptId: String(attempt.id) };
}

/** Push a proposal's interest window into the past so the next tick resolves it. */
export async function expireInterestWindow(attemptId: string): Promise<void> {
  await pool.query(`UPDATE formation_attempts SET interest_closes_at = now() - interval '1 minute' WHERE id = $1`, [attemptId]);
}

/** Seed `n` distinct interested players ("I'm in") for a proposal. */
export async function seedInterested(attemptId: string, n: number): Promise<void> {
  const tag = String(attemptId).slice(0, 8);
  for (let i = 0; i < n; i++) {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, 0, 0, '00000', now()) RETURNING id`,
      [`seed-${tag}-in${i}@example.com`, `In ${i + 1}`],
    );
    await pool.query("INSERT INTO attempt_interest (attempt_id, user_id, interested) VALUES ($1, $2, true) ON CONFLICT DO NOTHING", [attemptId, u.id]);
  }
}

/** A formation attempt's status (OPEN / CONFIRMED / FAILED / CANCELLED). */
export async function getAttemptStatus(attemptId: string): Promise<string> {
  const { rows: [a] } = await pool.query(`SELECT status FROM formation_attempts WHERE id = $1`, [attemptId]);
  return a?.status ?? "";
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
    `INSERT INTO areas (activity_type_id, h3_cell, display_city, display_zip, center_lat, center_lng, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED') RETURNING id`,
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

/** A user's donation_status (unset / subscribed / declined) — for the Stripe e2e. */
export async function getDonationStatus(email: string): Promise<string> {
  const { rows: [u] } = await pool.query("SELECT donation_status FROM users WHERE lower(email) = lower($1)", [email]);
  return u?.donation_status ?? "";
}

/** Mark a user a supporter (or any donation_status) — for the email thank-you path. */
export async function setDonationStatus(email: string, status: "unset" | "subscribed" | "declined"): Promise<void> {
  await pool.query("UPDATE users SET donation_status = $2 WHERE lower(email) = lower($1)", [email, status]);
}

/** The id of a registered user, by email — to wire up roster/captain/RSVP rows. */
export async function getUserId(email: string): Promise<string> {
  const { rows } = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (!rows[0]) throw new Error(`no user with email ${email}`);
  return String(rows[0].id);
}

/** An active standing game seeded directly into a player's OWN home area — the
 *  area their real interest signal already resolved to at registration. Unlike
 *  seedStandingGame (which computes its own area from a hand-picked lat/lng),
 *  this guarantees area-id equality with what the app itself looks up for that
 *  user, which matters for anything keyed strictly on "your home area" (e.g. the
 *  map HUD) rather than mere on-map proximity. */
/** Resolves a registered player's OWN flag-football area — the exact area the
 *  map HUD looks at for them (play/page.tsx). Every "seed X in my area" helper
 *  below goes through this rather than independently computing an area from a
 *  hand-picked lat/lng (which can land in a different H3 cell than the real
 *  zip_centroid for the same nominal ZIP). */
async function resolveMyArea(email: string) {
  const userId = await getUserId(email);
  const { rows: [act] } = await pool.query("SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1");
  if (!act) throw new Error("no flag-football activity_type row — is the seed fixture loaded?");
  const { rows: [signal] } = await pool.query(
    "SELECT area_id FROM interest_signals WHERE user_id = $1 AND activity_type_id = $2 AND active = true LIMIT 1",
    [userId, act.id],
  );
  if (!signal) throw new Error(`no active flag-football interest signal for ${email} — register them first`);
  const { rows: [area] } = await pool.query("SELECT center_lat, center_lng FROM areas WHERE id = $1", [signal.area_id]);
  if (!area) throw new Error(`interest signal for ${email} points at a missing area (${signal.area_id})`);
  return { userId, activityTypeId: String(act.id), areaId: String(signal.area_id), lat: area.center_lat, lng: area.center_lng };
}

/** A standing game rostered with real people — the honest "a game exists here"
 *  state, backed by `rosterIds` (never a ghost game with nobody in it). */
async function insertStandingGameRostered(
  activityTypeId: string, areaId: string, placeText: string, lat: number, lng: number, rosterIds: string[],
): Promise<string> {
  const { rows: [game] } = await pool.query(
    `INSERT INTO games
       (activity_type_id, area_id, place_text, place_lat, place_lng,
        scheduled_start, status, is_standing, recur_dow, recur_time, color, confirmed_count)
     VALUES ($1, $2, $3, $4, $5, now() + interval '5 days', 'active', true, 6, '10:00', '#16633a', $6)
     RETURNING id`,
    [activityTypeId, areaId, placeText, lat, lng, rosterIds.length],
  );
  for (const uid of rosterIds) {
    await pool.query(
      `INSERT INTO game_roster (game_id, user_id, default_status) VALUES ($1, $2, 'in') ON CONFLICT DO NOTHING`,
      [game.id, uid],
    );
  }
  return String(game.id);
}

/** N persistent "neighbor" users with real active interest in `email`'s area —
 *  the ambient-interest state, AND the cohort reused downstream to back the
 *  proposal and roster the games. Homes sit at the area centroid so they're
 *  always within anyone's default travel radius. Returns their ids so later
 *  steps reuse the SAME people (one honest arc, not throwaway-per-stage). */
export async function seedNeighborsInMyArea(email: string, n: number): Promise<string[]> {
  const { activityTypeId, areaId, lat, lng } = await resolveMyArea(email);
  const tag = `${areaId}`.slice(0, 8);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (email, display_name, home_lat, home_lng, zip, email_verified)
       VALUES ($1, $2, $3, $4, '00000', now()) RETURNING id`,
      [`nb-${tag}-${i}@example.com`, `Neighbor ${i + 1}`, lat, lng],
    );
    await pool.query(
      `INSERT INTO interest_signals (activity_type_id, user_id, area_id, h3_base, active)
       VALUES ($1, $2, $3, 0, true)`,
      [activityTypeId, u.id, areaId],
    );
    ids.push(String(u.id));
  }
  return ids;
}

/** An OPEN proposal backed by an EXISTING cohort — every one of them is "in",
 *  so the HUD's tally is real interest (cohort.length / pMin), not a fabricated
 *  number. The proposer is one of them (matching the real proposeGame flow). */
export async function openProposalBackedBy(email: string, placeText: string, cohortIds: string[]): Promise<string> {
  const { activityTypeId, areaId, lat, lng } = await resolveMyArea(email);
  const { rows: [att] } = await pool.query(
    `INSERT INTO formation_attempts
       (activity_type_id, area_id, attempt_number, status, proposer_id,
        place_text, place_lat, place_lng, proposed_start, recur_dow, recur_time, interest_closes_at)
     VALUES ($1, $2, 1, 'OPEN', $3, $4, $5, $6, now() + interval '5 days', 6, '10:00', now() + interval '24 hours')
     RETURNING id`,
    [activityTypeId, areaId, cohortIds[0], placeText, lat, lng],
  );
  for (const uid of cohortIds) {
    await pool.query(
      `INSERT INTO attempt_interest (attempt_id, user_id, interested) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
      [att.id, uid],
    );
  }
  return String(att.id);
}

/** Confirm a proposal into a real standing game — it forms at the proposed spot
 *  and is rostered with the cohort that backed it (the attempt goes CONFIRMED
 *  and points at the game, as the real resolve does). Returns gameId. */
export async function confirmProposalIntoGame(email: string, attemptId: string, cohortIds: string[]): Promise<string> {
  const { activityTypeId, areaId, lat, lng } = await resolveMyArea(email);
  const { rows: [att] } = await pool.query("SELECT place_text FROM formation_attempts WHERE id = $1", [attemptId]);
  const gameId = await insertStandingGameRostered(activityTypeId, areaId, att.place_text, lat, lng, cohortIds);
  await pool.query("UPDATE formation_attempts SET status = 'CONFIRMED', scheduled_game_id = $1 WHERE id = $2", [gameId, attemptId]);
  return gameId;
}

/** A second standing game in the same area, also rostered with real people. */
export async function seedGameRosteredInMyArea(email: string, placeText: string, cohortIds: string[]): Promise<string> {
  const { activityTypeId, areaId, lat, lng } = await resolveMyArea(email);
  return insertStandingGameRostered(activityTypeId, areaId, placeText, lat, lng, cohortIds);
}

/** How many real people are on a game's roster — proves a game isn't a ghost. */
export async function gameRosterCount(gameId: string): Promise<number> {
  const { rows: [r] } = await pool.query("SELECT count(*)::int AS c FROM game_roster WHERE game_id = $1", [gameId]);
  return Number(r?.c ?? 0);
}

/** Make a user a captain of an area (gates the captain controls in the popup). */
export async function seedCaptain(areaId: string, email: string): Promise<void> {
  const userId = await getUserId(email);
  await pool.query(
    "INSERT INTO area_captains (area_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [areaId, userId],
  );
}

/** Whether a user is a captain of an area — to assert the propose flow claimed them. */
export async function isAreaCaptain(areaId: string, email: string): Promise<boolean> {
  const userId = await getUserId(email);
  const { rows } = await pool.query(
    "SELECT 1 FROM area_captains WHERE area_id = $1 AND user_id = $2 LIMIT 1",
    [areaId, userId],
  );
  return rows.length > 0;
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

/** A weekly occurrence with its poll OPEN (opened in the past, closes + kicks off
 *  in the future) so the one-click RSVP link is live. Pass `notifyEmail` to also
 *  enqueue a POLL_ASK to that roster member — the next tick flushes the weekly
 *  rsvp email (with its i'm in / i'm out links) to their inbox, the way the real
 *  poll-opener would. Returns the occurrence id. */
export async function seedScheduledOccurrence(gameId: string, notifyEmail?: string): Promise<string> {
  const DAY = 86_400_000;
  const now = Date.now();
  const kickoff = new Date(now + 2 * DAY);    // future → rsvp stays open
  const pollOpens = new Date(now - 1 * DAY);
  const pollCloses = new Date(now + 1 * DAY); // future → the tick won't tally/close it
  const { rows } = await pool.query(
    `INSERT INTO game_occurrences
       (game_id, occurrence_date, status, kickoff_at, poll_opens_at, poll_closes_at, in_count)
     VALUES ($1, $2::date, 'polling', $3, $4, $5, 0)
     RETURNING id`,
    [gameId, kickoff.toISOString(), kickoff.toISOString(), pollOpens.toISOString(), pollCloses.toISOString()],
  );
  const occId = String(rows[0].id);
  if (notifyEmail) {
    const uid = await getUserId(notifyEmail);
    await pool.query(
      `INSERT INTO notifications_sent (user_id, occurrence_id, game_id, kind, channel)
       VALUES ($1, $2, $3, 'POLL_ASK', 'email') ON CONFLICT DO NOTHING`,
      [uid, occId, gameId],
    );
    // Keep the engine's poll-opener out of this scenario: shrink the game's poll
    // window so its next recurrence isn't "due to open" now. The tick then only
    // flushes the POLL_ASK above — no spontaneous second poll for another week.
    await pool.query(
      `UPDATE areas SET polling_start_offset = interval '1 hour'
       WHERE id = (SELECT area_id FROM games WHERE id = $1)`,
      [gameId],
    );
  }
  return occId;
}
