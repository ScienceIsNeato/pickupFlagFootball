import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "./index";
import { interestSignals } from "./schema";

/** Minimal "can run raw SQL" client — satisfied by both the one-shot neon-http `db`
 *  and a pooled transaction (`tx`), so callers can run setActiveInterest inside a
 *  transaction with the rest of their writes. */
export type SqlExecutor = { execute(query: SQL): Promise<unknown> };

/** True if the user has any active interest signal — i.e. they've been through
 *  the location/interest step. Gates the "my games" nav link: it stays hidden
 *  until a user has registered AND shown interest in an area. */
export async function hasActiveInterest(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: interestSignals.id }).from(interestSignals)
    .where(and(eq(interestSignals.userId, userId), eq(interestSignals.active, true)))
    .limit(1);
  return !!row;
}

/**
 * Point a user's active interest for an activity at exactly one area, atomically.
 *
 * neon-http is one-shot (no transactions), so the naive "deactivate all signals,
 * then upsert one active" pair isn't atomic: if the upsert failed after the
 * deactivate, the user would be left with zero active interest and the dashboard
 * would bounce them back to show-interest. A single writable-CTE statement
 * upserts the target row active, then deactivates the user's other signals for
 * the activity — both halves commit together or not at all.
 *
 * h3Base is passed as a string: the neon-http driver serializes params as JSON
 * and can't encode a JS bigint, so we stringify and let Postgres coerce to the
 * bigint column.
 */
export async function setActiveInterest(
  activityTypeId: string,
  userId: string,
  areaId: string,
  h3Base: bigint,
  client: SqlExecutor = db,
): Promise<void> {
  await client.execute(sql`
    with up as (
      insert into interest_signals (activity_type_id, user_id, area_id, h3_base, active)
      values (${activityTypeId}, ${userId}, ${areaId}, ${h3Base.toString()}, true)
      on conflict (activity_type_id, user_id, area_id)
      do update set active = true, h3_base = excluded.h3_base
      returning area_id
    )
    update interest_signals
    set active = false
    where user_id = ${userId}
      and activity_type_id = ${activityTypeId}
      and area_id <> (select area_id from up)
  `);
}
