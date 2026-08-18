import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { txnDb } from "@/lib/db/pool";
import { chatMessages, chatReads, chatThreads } from "@/lib/db/schema";
import {
  chatAccess, threadPage, tombstonesSince, type ChatSubject,
} from "@/lib/chat/eligibility";

export const dynamic = "force-dynamic";

/**
 * Per-game chat. GET polls; POST sends, marks-read, or soft-deletes your own
 * message. Everything routes through chatAccess() so the read/write gate is
 * evaluated in exactly one place and can't be bypassed by guessing a thread id —
 * callers address a GAME or an ATTEMPT they can be checked against, never a raw
 * thread. See docs/design/game-chat.md.
 */

const MAX_BODY = 1000;
const RATE_PER_MIN = 5;

function subjectOf(gameId: string | null, attemptId: string | null): ChatSubject | null {
  if (gameId) return { kind: "game", id: gameId };
  if (attemptId) return { kind: "attempt", id: attemptId };
  return null;
}

/** Poll: messages after `after`, plus tombstones for anything deleted since `since`.
 *  An after-cursor alone only returns rows ABOVE it, so a captain's delete of an
 *  older message would otherwise never reach a panel that's already scrolled past. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const subj = subjectOf(url.searchParams.get("gameId"), url.searchParams.get("attemptId"));
  if (!subj) return NextResponse.json({ error: "bad subject" }, { status: 400 });
  const after = Number(url.searchParams.get("after") ?? 0);
  const since = url.searchParams.get("since");

  const access = await chatAccess(session.user.id, subj);
  if (!access.ok) {
    // 200 with a reason, not 403: the panel renders a specific explanation for each
    // of these ("confirm your email", "this chat is for people who play here").
    return NextResponse.json({ ok: false, reason: access.reason });
  }
  if (!access.threadId) {
    return NextResponse.json({
      ok: true, threadId: null, version: 0, locked: false,
      canWrite: access.canWrite, messages: [], tombstones: [],
    });
  }

  const [t] = await db.select({ version: chatThreads.version, locked: chatThreads.locked })
    .from(chatThreads).where(eq(chatThreads.id, access.threadId)).limit(1);
  const [messages, tombstones] = await Promise.all([
    threadPage(access.threadId, Number.isFinite(after) ? after : 0),
    tombstonesSince(access.threadId, since),
  ]);

  return NextResponse.json({
    ok: true,
    threadId: access.threadId,
    version: t?.version ?? 0,
    locked: t?.locked ?? false,
    canWrite: access.canWrite && !(t?.locked ?? false),
    messages,
    tombstones,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = session.user.id;

  const payload = (await req.json().catch(() => null)) as {
    action?: string; gameId?: string; attemptId?: string; body?: string; seq?: number;
  } | null;
  if (!payload) return NextResponse.json({ error: "bad json" }, { status: 400 });

  const subj = subjectOf(payload.gameId ?? null, payload.attemptId ?? null);
  if (!subj) return NextResponse.json({ error: "bad subject" }, { status: 400 });

  const access = await chatAccess(me, subj);
  if (!access.ok) return NextResponse.json({ ok: false, reason: access.reason }, { status: 403 });

  if (payload.action === "read") return markRead(me, access.threadId);
  if (payload.action === "delete") return softDelete(me, access.threadId, Number(payload.seq));
  return send(me, subj, access.threadId, String(payload.body ?? ""));
}

/** Mark the thread read up to now. Idempotent; drives the unread dot only. */
async function markRead(userId: string, threadId: string | null) {
  if (!threadId) return NextResponse.json({ ok: true });
  await db.insert(chatReads).values({ threadId, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [chatReads.threadId, chatReads.userId],
      set: { lastReadAt: new Date() },
    });
  return NextResponse.json({ ok: true });
}

/** Author-only soft delete. v1 has no captain moderation: volunteerAsCaptain is
 *  self-service, so captain powers would let any verified account moderate any
 *  thread on the platform (design §9). */
async function softDelete(userId: string, threadId: string | null, seq: number) {
  if (!threadId || !Number.isFinite(seq)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const done = await txnDb.transaction(async (tx) => {
    const hit = await tx.update(chatMessages)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(and(
        eq(chatMessages.threadId, threadId),
        eq(chatMessages.seq, seq),
        eq(chatMessages.userId, userId),
        sql`${chatMessages.deletedAt} is null`,
      ))
      .returning({ id: chatMessages.id });
    if (!hit.length) return false;
    // Bump version so open panels pick the tombstone up, and drop the counter so the
    // map badge doesn't keep counting a removed message.
    await tx.update(chatThreads).set({
      version: sql`${chatThreads.version} + 1`,
      messageCount: sql`greatest(${chatThreads.messageCount} - 1, 0)`,
    }).where(eq(chatThreads.id, threadId));
    return true;
  });
  return done
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, reason: "notyours" }, { status: 403 });
}

async function send(userId: string, subj: ChatSubject, threadId: string | null, raw: string) {
  const body = raw.trim();
  if (!body) return NextResponse.json({ ok: false, reason: "empty" }, { status: 400 });
  if (body.length > MAX_BODY) return NextResponse.json({ ok: false, reason: "toolong" }, { status: 400 });

  const result = await txnDb.transaction(async (tx) => {
    // Rate limit as ONE atomic statement. A count-then-insert takes no locks, so
    // under READ COMMITTED two concurrent sends both read 4, both pass, both insert.
    // Zero rows back = over the cap.
    const gate = await tx.execute(sql`
      insert into chat_rate (user_id, window_start, n)
      values (${userId}::uuid, date_trunc('minute', now()), 1)
      on conflict (user_id, window_start)
      do update set n = chat_rate.n + 1 where chat_rate.n < ${RATE_PER_MIN}
      returning n`);
    if (!((gate as unknown as { rows?: unknown[] }).rows ?? []).length) return { limited: true as const };

    // Create the thread on first message rather than on every page view. Keyed on
    // the ATTEMPT when the game came from one, so a formed game keeps the proposal's
    // conversation without anything being migrated.
    let id = threadId;
    if (!id) {
      const key = subj.kind === "attempt"
        ? { attemptId: subj.id }
        : await attemptKeyForGame(tx, subj.id);
      const ins = await tx.insert(chatThreads).values(key).onConflictDoNothing()
        .returning({ id: chatThreads.id });
      id = ins[0]?.id ?? null;
      if (!id) {
        // Lost the race — the winner's row is what we want.
        const [existing] = await tx.select({ id: chatThreads.id }).from(chatThreads)
          .where(key.attemptId
            ? eq(chatThreads.attemptId, key.attemptId)
            : eq(chatThreads.gameId, key.gameId!))
          .limit(1);
        id = existing?.id ?? null;
      }
      if (!id) return { failed: true as const };
    }

    // Lock the thread, then take seq from max(seq) — NOT message_count, which the
    // soft delete decrements and would therefore hand out a duplicate seq.
    await tx.execute(sql`select 1 from chat_threads where id = ${id}::uuid for update`);
    const next = await tx.execute(sql`
      select coalesce(max(seq), 0) + 1 as seq from chat_messages where thread_id = ${id}::uuid`);
    const seq = Number(((next as unknown as { rows?: { seq: number }[] }).rows ?? [])[0]?.seq ?? 1);

    await tx.insert(chatMessages).values({ threadId: id, seq, userId, body });
    // Your own message must not light your own unread dot.
    await tx.insert(chatReads).values({ threadId: id, userId, lastReadAt: new Date() })
      .onConflictDoUpdate({
        target: [chatReads.threadId, chatReads.userId],
        set: { lastReadAt: new Date() },
      });
    await tx.execute(sql`
      update chat_threads
         set message_count = message_count + 1,
             last_message_at = now(),
             version = version + 1,
             -- Arm the next digest boundary only if one isn't already pending, so a
             -- burst of messages can't push the wake outward. Null everywhere means
             -- chat owes nobody mail and the tick arms no wake at all (design §8.6).
             digest_due_at = coalesce(digest_due_at, date_trunc('hour', now()) + interval '1 hour')
       where id = ${id}::uuid`);
    return { seq, threadId: id };
  });

  if ("limited" in result) return NextResponse.json({ ok: false, reason: "ratelimited" }, { status: 429 });
  if ("failed" in result) return NextResponse.json({ ok: false, reason: "retry" }, { status: 409 });
  return NextResponse.json({ ok: true, seq: result.seq, threadId: result.threadId });
}

/** A formed game's thread hangs off its originating proposal when it had one. */
async function attemptKeyForGame(
  tx: Parameters<Parameters<typeof txnDb.transaction>[0]>[0],
  gameId: string,
): Promise<{ attemptId?: string; gameId?: string }> {
  const got = await tx.execute(sql`select origin_attempt_id from games where id = ${gameId}::uuid`);
  const originId = ((got as unknown as { rows?: { origin_attempt_id: string | null }[] }).rows ?? [])[0]?.origin_attempt_id;
  return originId ? { attemptId: originId } : { gameId };
}
