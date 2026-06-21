"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { txnDb } from "@/lib/db/pool";
import { cellToLatLng, latLngToCell } from "h3-js";
import {
  activityTypes, areas, formationAttempts, notificationsSent, areaCaptains, users,
} from "@/lib/db/schema";
import { h3ToBigInt, diskCells } from "@/lib/geo/h3";
import { ensureArea } from "@/lib/geo/ensureArea";
import { haversineKm } from "@/lib/geo/distance";
import { shouldRetrigger } from "@/lib/mime";
import { loadTunables, catchmentUsers } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";
import { isEmailVerified } from "@/lib/auth/verified";

const edb = () => db as unknown as EngineDb;
function coord(raw: string, lo: number, hi: number): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

export type ProposeResult = { ok: true } | { ok: false; reason: string };

/**
 * "Propose new game here" from the map. Records a suggestion against the area's
 * live suggestion window — seeding one (a user-initiated spark) if the area
 * doesn't have an open attempt yet. Returns a result (no redirect) so the modal
 * can show a thank-you and the map can drop the proposed badge in place.
 */
export async function proposeGame(_prev: ProposeResult | null, formData: FormData): Promise<ProposeResult> {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/play");
  if (!(await isEmailVerified(session.user.id))) return { ok: false, reason: "unverified" };

  const h3 = String(formData.get("h3") ?? "").trim();
  const start = String(formData.get("start") ?? "").trim();

  // Structured venue: street/spot, city, zip, + optional meeting notes. Compose
  // into a single human place label ("1806 Brown Deer Trail, Coralville 52241 —
  // park in east lot, gate code 1234"), which threads through to the formed game.
  const street = String(formData.get("place_street") ?? "").trim();
  const city = String(formData.get("place_city") ?? "").trim();
  const zip = String(formData.get("place_zip") ?? "").trim();
  const notes = String(formData.get("place_notes") ?? "").trim();
  if (!h3 || !street || !city || !zip || !start) return { ok: false, reason: "missing" };
  const place = [
    [street, `${city} ${zip}`.trim()].filter(Boolean).join(", "),
    notes,
  ].filter(Boolean).join(" — ");

  const when = new Date(start);
  if (Number.isNaN(when.getTime())) return { ok: false, reason: "missing" };

  const placeLat = coord(String(formData.get("place_lat") ?? ""), -90, 90);
  const placeLng = coord(String(formData.get("place_lng") ?? ""), -180, 180);

  // Recurring weekly slot (proposer's day-of-week + local time). `when`
  // (proposed_start) is the first game; these promote the formed game to standing.
  const dowRaw = Number(String(formData.get("recur_dow") ?? ""));
  const recurDow = Number.isInteger(dowRaw) && dowRaw >= 0 && dowRaw <= 6 ? dowRaw : null;
  const timeRaw = String(formData.get("recur_time") ?? "").trim();
  const recurTime = /^\d{2}:\d{2}$/.test(timeRaw) ? `${timeRaw}:00` : null;

  // Resolve the area from the picked venue when we have its coords (right-click
  // can be coarse at low zoom; the chosen address is the real spot). Fall back to
  // the click's r7 cell.
  const cell = placeLat != null && placeLng != null
    ? h3ToBigInt(latLngToCell(placeLat, placeLng, 7))
    : h3ToBigInt(h3);
  const [act] = await db.select({ id: activityTypes.id }).from(activityTypes)
    .where(eq(activityTypes.slug, "flag-football")).limit(1);
  if (!act) throw new Error("activity not configured");

  const disk = diskCells(cell, 1);

  // You can propose anywhere within your own travel radius of home — that's your
  // "area of interest" (the radius drawn on the map). Mirrors the client preview.
  const [me] = await db.select({ lat: users.homeLat, lng: users.homeLng, km: users.maxTravelKm })
    .from(users).where(eq(users.id, session.user.id)).limit(1);
  if (me?.lat == null || me?.lng == null) return { ok: false, reason: "nolocation" };
  const [tLat, tLng] = placeLat != null && placeLng != null ? [placeLat, placeLng] : cellToLatLng(h3);
  if (haversineKm(me.lat, me.lng, tLat, tLng) > (me.km ?? 24.14)) return { ok: false, reason: "outofrange" };

  // Resolve the area for this exact cell, creating it if a right-click landed on a
  // spot with no area row yet (the proposer is already a verified local above).
  let [area] = await db.select().from(areas)
    .where(and(eq(areas.activityTypeId, act.id), eq(areas.h3Cell, cell))).limit(1);
  if (!area) {
    const [clat, clng] = placeLat != null && placeLng != null ? [placeLat, placeLng] : cellToLatLng(h3);
    await ensureArea(act.id, cell, { city: "", zip: "", centerLat: clat, centerLng: clng });
    [area] = await db.select().from(areas)
      .where(and(eq(areas.activityTypeId, act.id), eq(areas.h3Cell, cell))).limit(1);
  }
  if (!area) return { ok: false, reason: "retry" };

  // A game is already scheduled here — don't undo it by spawning a new attempt.
  if (area.status === "SCHEDULED") return { ok: false, reason: "scheduled" };

  // Find any LIVE attempt (not just SUGGESTING) so we don't collide with the
  // one-live-attempt index or demote an in-flight formation.
  const [live] = await db.select().from(formationAttempts)
    .where(and(
      eq(formationAttempts.areaId, area.id),
      inArray(formationAttempts.status, ["SUGGESTING", "COMPILING", "AVAILABILITY", "ADJUDICATING"]),
    )).limit(1);

  // Suggestions are only accepted during the suggestion window.
  if (live && live.status !== "SUGGESTING") return { ok: false, reason: "closed" };

  let attempt = live;
  if (!attempt) {
    const t = await loadTunables(edb(), act.id, area);
    // Same radius rule the engine uses: everyone active whose travel radius
    // reaches this site. Measure to the proposed venue (the address the user
    // picked) when known, falling back to the area centroid.
    const cohort = await catchmentUsers(edb(), act.id, placeLat ?? area.centerLat, placeLng ?? area.centerLng);
    const now = new Date();
    // A stalled area is in cooldown — respect the backoff like the engine does,
    // don't let a manual propose re-open it early.
    if (area.status === "STALLED" &&
        !shouldRetrigger(now, area.nextTriggerAt ?? null, area.nextTriggerInterest ?? null, cohort.length)) {
      return { ok: false, reason: "cooldown" };
    }
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${formationAttempts.attemptNumber}),0)::int` })
      .from(formationAttempts).where(eq(formationAttempts.areaId, area.id));
    try {
      // Manual spark, same atomicity as the engine's: the attempt insert, the
      // area → IN_FORMATION flip and the SPARK_ASK rows commit together (pooled
      // client) so we can't leave a live attempt next to a DORMANT/STALLED area.
      attempt = await txnDb.transaction(async (tx) => {
        const [a] = await tx.insert(formationAttempts).values({
          activityTypeId: act.id, areaId: area.id, attemptNumber: n + 1, status: "SUGGESTING",
          catchmentCells: disk, cohortUserIds: cohort,
          suggestionOpenedAt: now, suggestionClosesAt: new Date(now.getTime() + t.suggestWindowH * 3_600_000),
        }).returning();
        await tx.update(areas).set({ status: "IN_FORMATION" }).where(eq(areas.id, area.id));
        if (cohort.length) {
          await tx.insert(notificationsSent).values(cohort.map((u) => ({
            userId: u, attemptId: a.id, kind: "SPARK_ASK" as const, channel: "email" as const, sentAt: now,
          }))).onConflictDoNothing();
        }
        return a;
      });
    } catch (e) {
      // Only the one-live-attempt conflict is expected (a concurrent propose).
      const pgCode = (e as { cause?: { code?: string } }).cause?.code;
      const msg = e instanceof Error ? e.message : String(e);
      if (pgCode !== "23505" && !/uq_one_live_attempt|unique|duplicate|23505/i.test(msg)) throw e;
      // attach to the window the winner just opened
      [attempt] = await db.select().from(formationAttempts)
        .where(and(eq(formationAttempts.areaId, area.id), eq(formationAttempts.status, "SUGGESTING")))
        .limit(1);
    }
  }
  if (!attempt) return { ok: false, reason: "retry" };

  // The SUGGESTING check above is a read; a concurrent tick (or the window
  // closing right after the unique-conflict reload) could move the attempt to
  // AVAILABILITY before this insert lands. Gate the insert on the attempt still
  // being SUGGESTING in the same statement so we never record a suggestion
  // against a closed window. neon-http is one-shot (no txn), so this conditional
  // INSERT…SELECT is the atomic unit.
  const inserted = await db.execute(sql`
    insert into suggestions (attempt_id, user_id, place_text, place_lat, place_lng, proposed_start, recur_dow, recur_time)
    select ${attempt.id}, ${session.user.id}, ${place}, ${placeLat}, ${placeLng}, ${when.toISOString()}, ${recurDow}, ${recurTime}
    where exists (
      select 1 from formation_attempts where id = ${attempt.id} and status = 'SUGGESTING'
    )
    returning id
  `);
  if (inserted.rows.length === 0) return { ok: false, reason: "closed" };

  // Proposer becomes a captain of this site automatically.
  await db.insert(areaCaptains)
    .values({ areaId: area.id, userId: session.user.id })
    .onConflictDoNothing();

  return { ok: true };
}
