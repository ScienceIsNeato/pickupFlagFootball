import { eq, sql } from "drizzle-orm";
import { games } from "@/lib/db/schema";
import { occurrenceDatesInRange } from "@/lib/datetime";
import type { EngineDb } from "./engine";

const DAY_MS = 86_400_000;

/**
 * Freeze recently-passed game occurrences into the attendance record.
 *
 * Per-occurrence RSVPs (explicit "in"/"out") live in game_attendance, but a
 * "regular" who relies on their site default never writes a row. So as each
 * occurrence passes we materialize an explicit "in" row for every roster member
 * whose default is "in" and who hasn't already opted out — capturing the roster
 * as it stood that week. After this runs, game_attendance is the historical
 * truth: headcount = count of "in"; "were you there" = your "in" row.
 *
 * Idempotent (insert … on conflict do nothing) and bounded to the last two weeks,
 * so the 15-minute cron can call it every tick. Runs late enough after an
 * occurrence that the roster reflects who was actually signed up.
 */
export async function freezeOccurrences(db: EngineDb, now: Date): Promise<void> {
  const standing = await db.select({
    id: games.id, recurDow: games.recurDow, scheduledStart: games.scheduledStart,
  }).from(games).where(eq(games.status, "STANDING"));

  const yesterday = new Date(now.getTime() - DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  for (const g of standing) {
    const dates = occurrenceDatesInRange(
      { isStanding: true, recurDow: g.recurDow, scheduledStart: String(g.scheduledStart) },
      twoWeeksAgo, yesterday,
    );
    for (const date of dates) {
      await db.execute(sql`
        insert into game_attendance (game_id, user_id, occurrence_date, status)
        select r.game_id, r.user_id, ${date}::date, 'in'
        from game_roster r
        where r.game_id = ${g.id} and r.default_status = 'in'
          and not exists (
            select 1 from game_attendance a
            where a.game_id = r.game_id and a.user_id = r.user_id and a.occurrence_date = ${date}::date
          )
        on conflict do nothing`);
    }
  }
}
