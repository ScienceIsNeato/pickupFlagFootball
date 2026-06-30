"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { txnDb } from "@/lib/db/pool";
import { cellToLatLng, latLngToCell } from "h3-js";
import {
  activityTypes, areas, formationAttempts, attemptInterest, notificationsSent, areaCaptains, users, areaOptouts,
} from "@/lib/db/schema";
import { h3ToBigInt, diskCells } from "@/lib/geo/h3";
import { ensureArea } from "@/lib/geo/ensureArea";
import { haversineKm } from "@/lib/geo/distance";
import { loadTunables, catchmentUsers } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";
import { resolveProposal } from "@/lib/mime/trigger";
import { isEmailVerified } from "@/lib/auth/verified";
import { slackProposed } from "@/lib/slack";

const edb = () => db as unknown as EngineDb;
function coord(raw: string, lo: number, hi: number): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

export type ProposeResult = { ok: true } | { ok: false; reason: string };

/**
 * "Propose new game here" from the map. Each proposal is its OWN independent
 * attempt: it carries the full day/time/place, opens an interest window, and
 * emails nearby players a GAME_PROPOSED ask (Interested / Not-Interested). The
 * proposer is in by definition and becomes the site captain. Returns a result
 * (no redirect) so the modal can show its fanfare and the map can drop a badge.
 */
export async function proposeGame(_prev: ProposeResult | null, formData: FormData): Promise<ProposeResult> {
  const session = await auth();
  if (!session?.user?.id) redirect("/?signin=1&next=/play");
  const uid = session.user.id;
  if (!(await isEmailVerified(uid))) return { ok: false, reason: "unverified" };

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
    .from(users).where(eq(users.id, uid)).limit(1);
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

  const now = new Date();
  const t = await loadTunables(edb(), act.id, area);
  // Everyone active whose travel radius reaches this venue — minus the proposer
  // (they're already in, no need to email them the ask).
  const [cohortLat, cohortLng] = placeLat != null && placeLng != null
    ? [placeLat, placeLng]
    : [area.centerLat, area.centerLng];
  const cohort = (await catchmentUsers(edb(), act.id, cohortLat, cohortLng, area.id)).filter((u) => u !== uid);

  // One isolated attempt: the proposal, the proposer's "in", their captaincy, and
  // the GAME_PROPOSED asks all commit together (pooled client).
  await txnDb.transaction(async (tx) => {
    // Allocate attempt_number under an area-row lock so two concurrent proposals
    // in the same area can't read the same max and collide on the unique
    // (area_id, attempt_number) index.
    await tx.execute(sql`select 1 from areas where id = ${area.id} for update`);
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${formationAttempts.attemptNumber}), 0)::int` })
      .from(formationAttempts).where(eq(formationAttempts.areaId, area.id));
    const [a] = await tx.insert(formationAttempts).values({
      activityTypeId: act.id, areaId: area.id, attemptNumber: n + 1, status: "OPEN",
      proposerId: uid, placeText: place, placeLat, placeLng, proposedStart: when,
      recurDow, recurTime, catchmentCells: disk, cohortUserIds: cohort,
      interestClosesAt: new Date(now.getTime() + t.suggestWindowH * 3_600_000),
    }).returning({ id: formationAttempts.id });
    await tx.insert(attemptInterest).values({ attemptId: a.id, userId: uid, interested: true }).onConflictDoNothing();
    // Proposing here clears any prior "not interested in this area" opt-out — you're
    // obviously interested now, so you count toward and appear on the roster.
    await tx.delete(areaOptouts).where(and(eq(areaOptouts.areaId, area.id), eq(areaOptouts.userId, uid)));
    await tx.insert(areaCaptains).values({ areaId: area.id, userId: uid }).onConflictDoNothing();
    if (cohort.length) {
      await tx.insert(notificationsSent).values(cohort.map((u) => ({
        userId: u, attemptId: a.id, kind: "GAME_PROPOSED" as const, channel: "email" as const, sentAt: now,
      }))).onConflictDoNothing();
    }
  });

  // Activity feed: a new site was proposed (the attempt committed above).
  const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const whenStr = recurDow != null
    ? `${DOW[recurDow]}${recurTime ? ` ${recurTime.slice(0, 5)}` : ""}`
    : when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  slackProposed({ place, when: whenStr, closesInH: Math.round(t.suggestWindowH) });

  return { ok: true };
}

/** In-app Interested / Not-Interested on a proposal (the map popup buttons).
 *  Mirrors the email one-click flow; an "I'm in" can form the game on the spot. */
export async function respondInterest(attemptId: string, interested: boolean): Promise<ProposeResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, reason: "unauth" };
  if (!(await isEmailVerified(session.user.id))) return { ok: false, reason: "unverified" };
  const [att] = await db.select({
    status: formationAttempts.status, areaId: formationAttempts.areaId,
    lat: formationAttempts.placeLat, lng: formationAttempts.placeLng,
    areaLat: areas.centerLat, areaLng: areas.centerLng,
  }).from(formationAttempts)
    .leftJoin(areas, eq(areas.id, formationAttempts.areaId))
    .where(eq(formationAttempts.id, attemptId)).limit(1);
  if (!att) return { ok: false, reason: "missing" };
  if (att.status !== "OPEN") return { ok: false, reason: "closed" };
  // Eligibility: you can only weigh in on a game your travel radius could reach —
  // the same rule proposeGame applies to the proposer and the emailed cohort. Stops
  // a verified user from counting themselves into a far-off proposal by id. Uses the
  // venue, or the area centroid when the proposal has no exact coords (matching
  // cohort selection at propose time).
  const vLat = att.lat ?? att.areaLat;
  const vLng = att.lng ?? att.areaLng;
  if (vLat != null && vLng != null) {
    const [me] = await db.select({ lat: users.homeLat, lng: users.homeLng, km: users.maxTravelKm })
      .from(users).where(eq(users.id, session.user.id)).limit(1);
    if (me?.lat == null || me?.lng == null) return { ok: false, reason: "nolocation" };
    if (haversineKm(me.lat, me.lng, vLat, vLng) > (me.km ?? 24.14)) return { ok: false, reason: "outofrange" };
  }
  // Lock the attempt, re-check OPEN, and write in one transaction (same as the
  // email-link applyInterest), so a concurrent tick / resolve can't settle the
  // attempt between the check and the write and leave the click recorded on a
  // closed proposal (or off the formed roster).
  const uid = session.user.id;
  const outcome = await txnDb.transaction(async (tx) => {
    const [locked] = await tx.select({ status: formationAttempts.status })
      .from(formationAttempts).where(eq(formationAttempts.id, attemptId)).for("update").limit(1);
    if (!locked) return "missing";
    if (locked.status !== "OPEN") return "closed";
    await tx.insert(attemptInterest)
      .values({ attemptId, userId: uid, interested })
      .onConflictDoUpdate({ target: [attemptInterest.attemptId, attemptInterest.userId], set: { interested } });
    // Tapping "interested" re-engages you with this area: clear any prior opt-out
    // so you actually count toward + appear on the roster (same as proposing here).
    // A per-proposal "not interested" leaves the area opt-out untouched.
    if (interested) {
      await tx.delete(areaOptouts).where(and(eq(areaOptouts.areaId, att.areaId), eq(areaOptouts.userId, uid)));
    }
    return "ok";
  });
  if (outcome !== "ok") return { ok: false, reason: outcome };
  if (interested) await resolveProposal(attemptId);
  return { ok: true };
}
