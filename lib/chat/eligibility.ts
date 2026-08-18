import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  areaCaptains, areas, attemptInterest, chatMessages, chatThreads,
  formationAttempts, gameRoster, games, users,
} from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo/distance";

/**
 * THE definition of who may read and write a game's chat. The chat routes are its
 * only callers, so there is exactly one place this rule lives.
 *
 * Deliberately NOT reusing catchmentUsers: that predicate also requires
 * users.email_opt_in, which is the global email unsubscribe — reusing it would mean
 * unsubscribing from email silently revoked access to chat. And radius ALONE is
 * wrong in the other direction: app/api/map/route.ts is explicit that "Membership is
 * the roster, NOT proximity", so a rostered player who moves across town or narrows
 * their travel radius would keep the weekly poll email and the RSVP tally but lose
 * the chat for the game they play every week. Hence the union below.
 *
 * See docs/design/game-chat.md §4.
 */

/** What a chat hangs off: an open proposal, or a formed game. */
export type ChatSubject =
  | { kind: "attempt"; id: string }
  | { kind: "game"; id: string };

export type ChatAccess =
  | {
      ok: true;
      /** null until someone posts — threads are created lazily, not per page view. */
      threadId: string | null;
      locked: boolean;
      /** read is granted; write additionally needs a verified email + an unlocked thread. */
      canWrite: boolean;
      attemptId: string | null;
      gameId: string | null;
      areaId: string;
    }
  | { ok: false; reason: "notfound" | "unverified" | "ineligible" };

/** The proposal/game a thread belongs to, with the venue its radius check uses. */
type Subject = {
  attemptId: string | null;
  gameId: string | null;
  areaId: string;
  /** place coords when the venue is known, else the area centroid (never null). */
  lat: number;
  lng: number;
};

async function loadSubject(s: ChatSubject): Promise<Subject | null> {
  if (s.kind === "game") {
    const [g] = await db.select({
      gameId: games.id, attemptId: games.originAttemptId, areaId: games.areaId,
      lat: games.placeLat, lng: games.placeLng,
      areaLat: areas.centerLat, areaLng: areas.centerLng,
    }).from(games).innerJoin(areas, eq(areas.id, games.areaId))
      .where(eq(games.id, s.id)).limit(1);
    if (!g) return null;
    // games.place_lat/lng ARE nullable; area centroids are not. This is the only
    // place the coalesce is needed.
    return {
      attemptId: g.attemptId, gameId: g.gameId, areaId: g.areaId,
      lat: g.lat ?? g.areaLat, lng: g.lng ?? g.areaLng,
    };
  }
  const [a] = await db.select({
    attemptId: formationAttempts.id, areaId: formationAttempts.areaId,
    lat: formationAttempts.placeLat, lng: formationAttempts.placeLng,
    areaLat: areas.centerLat, areaLng: areas.centerLng,
  }).from(formationAttempts).innerJoin(areas, eq(areas.id, formationAttempts.areaId))
    .where(eq(formationAttempts.id, s.id)).limit(1);
  if (!a) return null;
  return {
    attemptId: a.attemptId, gameId: null, areaId: a.areaId,
    lat: a.lat ?? a.areaLat, lng: a.lng ?? a.areaLng,
  };
}

/**
 * Find the thread for a subject WITHOUT creating one. A game that formed from a
 * proposal keeps the proposal's thread — the link is derived here from
 * games.origin_attempt_id rather than backfilled when the game forms, so the
 * formation engine carries no chat code and there is no write race to lose.
 */
export async function findThread(subj: Subject) {
  const clauses = [
    subj.gameId ? eq(chatThreads.gameId, subj.gameId) : undefined,
    subj.attemptId ? eq(chatThreads.attemptId, subj.attemptId) : undefined,
  ].filter(Boolean);
  if (!clauses.length) return null;
  const [t] = await db.select({
    id: chatThreads.id, locked: chatThreads.locked, version: chatThreads.version,
    lastMessageAt: chatThreads.lastMessageAt, messageCount: chatThreads.messageCount,
  }).from(chatThreads)
    .where(clauses.length === 1 ? clauses[0] : or(...clauses))
    .limit(1);
  return t ?? null;
}

/**
 * Can this user see (and maybe write to) this chat? One query for the user, then at
 * most four cheap existence checks. Returns the thread when one exists.
 */
export async function chatAccess(userId: string, s: ChatSubject): Promise<ChatAccess> {
  const subj = await loadSubject(s);
  if (!subj) return { ok: false, reason: "notfound" };

  const [me] = await db.select({
    lat: users.homeLat, lng: users.homeLng, km: users.maxTravelKm,
    verified: users.emailVerified,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!me) return { ok: false, reason: "notfound" };

  const eligible = await isEligible(userId, subj, me);
  if (!eligible) return { ok: false, reason: "ineligible" };
  // Q1: reading requires a verified email too, not just writing. Without it the gate
  // is a throwaway registration and a typed ZIP away from open (design §4.2).
  if (me.verified == null) return { ok: false, reason: "unverified" };

  const t = await findThread(subj);
  return {
    ok: true,
    threadId: t?.id ?? null,
    locked: t?.locked ?? false,
    canWrite: !(t?.locked ?? false),
    attemptId: subj.attemptId, gameId: subj.gameId, areaId: subj.areaId,
  };
}

async function isEligible(
  userId: string, subj: Subject,
  me: { lat: number; lng: number; km: number },
): Promise<boolean> {
  // Proximity first — it's the common case and needs no extra round trip.
  if (haversineKm(me.lat, me.lng, subj.lat, subj.lng) <= (me.km ?? 24.14)) return true;

  // Otherwise membership: you play here, you captain here, or you answered this
  // proposal. Any of those outrank distance.
  if (subj.gameId) {
    const [r] = await db.select({ g: gameRoster.gameId }).from(gameRoster)
      .where(and(eq(gameRoster.gameId, subj.gameId), eq(gameRoster.userId, userId))).limit(1);
    if (r) return true;
  }
  const [c] = await db.select({ a: areaCaptains.areaId }).from(areaCaptains)
    .where(and(eq(areaCaptains.areaId, subj.areaId), eq(areaCaptains.userId, userId))).limit(1);
  if (c) return true;

  if (subj.attemptId) {
    const [i] = await db.select({ a: attemptInterest.attemptId }).from(attemptInterest)
      .where(and(eq(attemptInterest.attemptId, subj.attemptId), eq(attemptInterest.userId, userId))).limit(1);
    if (i) return true;
  }
  return false;
}

/** Messages a viewer should see: everything after their cursor, minus soft-deleted
 *  bodies (which come back separately as tombstones so open panels can drop them). */
export async function threadPage(threadId: string, afterSeq: number) {
  const rows = await db.execute(sql`
    select m.seq, m.body, m.created_at, m.user_id,
           u.display_name,
           (select 1 from area_captains ac
              join chat_threads t on t.id = m.thread_id
              left join games g on g.id = t.game_id
              left join formation_attempts fa on fa.id = t.attempt_id
             where ac.user_id = m.user_id
               and ac.area_id = coalesce(g.area_id, fa.area_id) limit 1) as is_captain,
           (select 1 from formation_attempts fa2
              join chat_threads t2 on t2.id = m.thread_id
             where fa2.id = t2.attempt_id and fa2.proposer_id = m.user_id limit 1) as is_proposer
      from chat_messages m
      left join users u on u.id = m.user_id
     where m.thread_id = ${threadId}::uuid
       and m.seq > ${afterSeq}
       and m.deleted_at is null
     order by m.seq asc
     limit 200`);
  return ((rows as { rows?: Record<string, unknown>[] }).rows ?? []).map((r) => ({
    seq: Number(r.seq),
    body: String(r.body),
    createdAt: new Date(r.created_at as string).toISOString(),
    authorId: (r.user_id as string | null) ?? null,
    // display_name is nullable and defaults to the email local part, so never fall
    // back to anything email-derived here — the privacy page promises other players
    // never see your email.
    author: (r.display_name as string | null) || "player",
    captain: r.is_captain != null,
    proposer: r.is_proposer != null,
  }));
}

/** Seqs deleted since the caller last synced, so an open panel can remove them. An
 *  after-cursor alone can never deliver these: it only returns rows ABOVE it. */
export async function tombstonesSince(threadId: string, sinceIso: string | null) {
  const rows = await db.select({ seq: chatMessages.seq }).from(chatMessages)
    .where(and(
      eq(chatMessages.threadId, threadId),
      sinceIso
        ? sql`${chatMessages.deletedAt} > ${sinceIso}::timestamptz`
        : sql`${chatMessages.deletedAt} is not null`,
    ));
  return rows.map((r) => Number(r.seq));
}

/**
 * How many chats have something this user hasn't seen. The eligibility union from
 * chatAccess() is inlined here rather than looped per thread: a naive
 * "last_message_at > last_read_at" would count threads the viewer isn't allowed to
 * read at all, which both inflates the dot and leaks that a conversation exists
 * somewhere they're gated out of.
 *
 * Cheap by construction — last_message_at is denormalized, so this never touches
 * chat_messages.
 */
export async function unreadChatCount(userId: string): Promise<number> {
  const res = await db.execute(sql`
    select count(*)::int as n
      from chat_threads t
      left join games g on g.id = t.game_id
      left join formation_attempts fa on fa.id = t.attempt_id
      -- a thread keyed on the proposal whose game has since formed
      left join games ga on ga.origin_attempt_id = t.attempt_id
      join areas a on a.id = coalesce(g.area_id, fa.area_id)
      join users u on u.id = ${userId}::uuid
      left join chat_reads r on r.thread_id = t.id and r.user_id = u.id
     where t.last_message_at is not null
       and (r.last_read_at is null or t.last_message_at > r.last_read_at)
       and u.email_verified is not null
       and (
         exists (select 1 from game_roster gr
                  where gr.game_id = coalesce(g.id, ga.id) and gr.user_id = u.id)
         or exists (select 1 from area_captains ac
                     where ac.area_id = a.id and ac.user_id = u.id)
         or exists (select 1 from attempt_interest ai
                     where ai.attempt_id = t.attempt_id and ai.user_id = u.id)
         or 6371 * 2 * asin(least(1, sqrt(
              power(sin(radians(u.home_lat - coalesce(g.place_lat, fa.place_lat, a.center_lat)) / 2), 2)
              + cos(radians(coalesce(g.place_lat, fa.place_lat, a.center_lat))) * cos(radians(u.home_lat))
              * power(sin(radians(u.home_lng - coalesce(g.place_lng, fa.place_lng, a.center_lng)) / 2), 2)
            ))) <= u.max_travel_km
       )`);
  const row = ((res as unknown as { rows?: { n: number }[] }).rows ?? [])[0];
  return Number(row?.n ?? 0);
}
