import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { unsubscribeUrl, unsubscribeApiUrl } from "@/lib/unsubscribeLink";

/**
 * Chat digest mail. Runs inside the cron tick, next to flushNotificationEmails.
 *
 * Cadence is enforced here rather than at write time, which is what lets the send
 * path stay a single UPDATE: a message just arms chat_threads.digest_due_at, and
 * this pass decides per recipient whether their "every message" / "at most one an
 * hour" / "one a day" window has elapsed. That reading matches the account page
 * wording exactly, and it means one pending thread can serve subscribers on three
 * different cadences without arming three different wakes.
 *
 * Deliberately does NOT consult chat_reads — the unread dot is in-app state, this is
 * send state, and neither reads the other (docs/design/game-chat.md §8.4).
 */

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

type Pending = {
  threadId: string;
  userId: string;
  email: string;
  displayName: string | null;
  pref: "each" | "hourly" | "daily";
  lastSeq: number;
  place: string;
  dueAt: number;
};

/** Minimum gap between digests, by cadence. "each" has none — it goes on the next tick. */
const GAP_MS: Record<Pending["pref"], number> = {
  each: 0,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

/**
 * Everyone who should get mail about a thread with pending messages.
 *
 * Recipients follow PARTICIPATION, not proximity (design §8.3): read access is
 * radius-based, so mailing everyone who *could* read would mail people about
 * strangers' games across their whole travel radius. Roster, captain, responded to
 * the proposal, or posted in the thread — those are the people who asked for it.
 */
async function pendingRecipients(now: Date): Promise<Pending[]> {
  // Recipients are derived PER THREAD, not by scanning the user table. The first
  // version joined users with no relationship to the thread and filtered with
  // EXISTS, so its cost grew with total accounts rather than with the handful of
  // people attached to the threads that actually owe mail — and this runs inside
  // the cron tick, where unpredictable runtime is the expensive kind.
  const res = await db.execute(sql`
    with due as (
      select t.id as thread_id, t.attempt_id,
             coalesce(g.id, ga.id) as eff_game_id,
             coalesce(g.area_id, fa.area_id) as area_id,
             coalesce(g.place_text, fa.place_text, '') as place
        from chat_threads t
        left join games g on g.id = t.game_id
        left join formation_attempts fa on fa.id = t.attempt_id
        left join games ga on ga.origin_attempt_id = t.attempt_id
       where t.digest_due_at is not null
         and t.digest_due_at <= ${now.toISOString()}::timestamptz
    ),
    -- participation, not proximity (design §8.3): read access is radius-based, so
    -- mailing everyone who *could* read would mail people about strangers' games.
    recips as (
      select d.thread_id, gr.user_id
        from due d join game_roster gr on gr.game_id = d.eff_game_id
      union
      select d.thread_id, ac.user_id
        from due d join area_captains ac on ac.area_id = d.area_id
      union
      -- interested = true only: a decliner said no to this proposal.
      select d.thread_id, ai.user_id
        from due d join attempt_interest ai
          on ai.attempt_id = d.attempt_id and ai.interested = true
      union
      select d.thread_id, cm.user_id
        from due d join chat_messages cm on cm.thread_id = d.thread_id
       where cm.user_id is not null
    )
    select d.thread_id, u.id as user_id, u.email, u.display_name,
           u.chat_email_pref as pref,
           coalesce(s.last_emailed_seq, 0) as last_seq,
           s.last_emailed_at,
           d.place
      from recips r
      join due d on d.thread_id = r.thread_id
      join users u on u.id = r.user_id
                  and u.email_opt_in = true
                  and u.email_verified is not null
                  and u.chat_email_pref <> 'off'
      left join chat_email_state s on s.thread_id = d.thread_id and s.user_id = u.id
     where exists (select 1 from chat_messages m
                    where m.thread_id = d.thread_id
                      and m.seq > coalesce(s.last_emailed_seq, 0)
                      and m.user_id is distinct from u.id
                      and m.deleted_at is null)`);
  const rows = ((res as unknown as { rows?: Record<string, unknown>[] }).rows ?? []);
  return rows.map((r) => {
    const pref = String(r.pref) as Pending["pref"];
    const last = r.last_emailed_at ? new Date(r.last_emailed_at as string).getTime() : 0;
    return {
      threadId: String(r.thread_id), userId: String(r.user_id),
      email: String(r.email), displayName: (r.display_name as string | null) ?? null,
      pref, lastSeq: Number(r.last_seq), place: String(r.place),
      // When their cadence window opens. Everyone pending is returned, due or not:
      // the ones who aren't due yet are exactly what re-arms the thread's next wake.
      dueAt: last ? last + GAP_MS[pref] : 0,
    };
  });
}

/** The messages one recipient is owed, oldest first. */
async function messagesFor(threadId: string, userId: string, afterSeq: number) {
  const res = await db.execute(sql`
    select m.seq, m.body, coalesce(u.display_name, 'player') as author
      from chat_messages m
      left join users u on u.id = m.user_id
     where m.thread_id = ${threadId}::uuid
       and m.seq > ${afterSeq}
       and m.user_id is distinct from ${userId}::uuid
       and m.deleted_at is null
     order by m.seq asc
     limit 50`);
  return ((res as unknown as { rows?: Record<string, unknown>[] }).rows ?? []).map((r) => ({
    seq: Number(r.seq), body: String(r.body), author: String(r.author),
  }));
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function build(p: Pending, msgs: { author: string; body: string }[], playUrl: string, unsub: string) {
  const where = p.place.split(" — ")[0] || "your game";
  const subject = msgs.length === 1
    ? `${msgs[0].author} posted about ${where}`
    : `${msgs.length} new messages about ${where}`;
  const lines = msgs.map((m) => `${m.author}: ${m.body}`).join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
      <p>new in the chat for <strong>${esc(where)}</strong>:</p>
      ${msgs.map((m) => `
        <div style="margin:0 0 14px;padding:10px 12px;background:#f4f5f7;border-radius:8px">
          <div style="font-weight:700;font-size:13px">${esc(m.author)}</div>
          <div>${esc(m.body)}</div>
        </div>`).join("")}
      <p><a href="${playUrl}" style="color:#2f7a39;font-weight:700">reply on the map</a></p>
      <p style="color:#888;font-size:12px">
        you're getting this because you're part of this game - on the roster, you said
        you're in, you captain here, or you've posted in the chat.
        <a href="${unsub}" style="color:#888">turn these off</a>.
      </p>
    </div>`;
  const text = `new in the chat for ${where}:\n\n${lines}\n\nreply: ${playUrl}\nturn these off: ${unsub}`;
  return { subject, htmlContent: html, textContent: text };
}

/**
 * Send every digest that's due. Returns what happened so the tick can log it.
 * Non-fatal by contract, same as flushNotificationEmails: a Brevo hiccup must not
 * fail the tick.
 */
export async function flushChatDigests(now: Date): Promise<{ sent: number; failed: number }> {
  const pending = await pendingRecipients(now);
  const due = pending.filter((p) => p.dueAt <= now.getTime());
  let sent = 0, failed = 0;
  const failedThreads = new Set<string>();

  for (const p of due) {
    const msgs = await messagesFor(p.threadId, p.userId, p.lastSeq);
    if (!msgs.length) continue;
    const mail = build(
      p, msgs,
      `${APP_BASE_URL}/play`,
      unsubscribeUrl(APP_BASE_URL, p.userId),
    );
    const ok = await sendEmail({
      to: p.email, toName: p.displayName, ...mail,
      listUnsubscribeUrl: unsubscribeApiUrl(APP_BASE_URL, p.userId),
    });
    if (!ok) { failed++; failedThreads.add(p.threadId); continue; }
    sent++;
    // Advance send state only after a delivered send, so a Brevo failure retries
    // on the next tick instead of silently swallowing the messages.
    const top = msgs[msgs.length - 1].seq;
    await db.execute(sql`
      insert into chat_email_state (user_id, thread_id, last_emailed_seq, last_emailed_at)
      values (${p.userId}::uuid, ${p.threadId}::uuid, ${top}, ${now.toISOString()}::timestamptz)
      on conflict (user_id, thread_id)
      do update set last_emailed_seq = ${top}, last_emailed_at = ${now.toISOString()}::timestamptz`);
  }

  // Re-arm from the SAME set the recipients came from, rather than a second
  // hand-written predicate that could disagree with it: a thread stays armed for the
  // earliest moment any still-pending recipient's window opens, and disarms only
  // when nobody is owed anything. A thread owing nobody arms no wake at all, which
  // is the entire point of the column (design §8.6).
  const stillPending = new Map<string, number>();
  for (const p of pending) {
    if (p.dueAt <= now.getTime()) continue; // handled above (or failed — see below)
    const cur = stillPending.get(p.threadId);
    if (cur == null || p.dueAt < cur) stillPending.set(p.threadId, p.dueAt);
  }
  // A failed send must not disarm the thread — leave it due so the next tick retries.
  for (const p of due) {
    if (!failedThreads.has(p.threadId)) continue;
    stillPending.set(p.threadId, now.getTime());
  }
  const threads = [...new Set(pending.map((p) => p.threadId))];
  for (const id of threads) {
    const next = stillPending.get(id);
    await db.execute(next == null
      ? sql`update chat_threads set digest_due_at = null where id = ${id}::uuid`
      : sql`update chat_threads set digest_due_at = ${new Date(next).toISOString()}::timestamptz
             where id = ${id}::uuid`);
  }

  return { sent, failed };
}
