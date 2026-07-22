import { NextResponse } from "next/server";
import { txnDb } from "@/lib/db/pool";
import { tick } from "@/lib/mime/engine";
import { runOccurrences } from "@/lib/mime/occurrences";
import { freezeOccurrences } from "@/lib/mime/freeze";
import { flushNotificationEmails } from "@/lib/email/flush";
import { scheduleNextTick } from "@/lib/mime/scheduleTick";
import type { EngineDb } from "@/lib/mime/engine";

export const dynamic = "force-dynamic";

/**
 * Time-based engine trigger. Vercel Cron hits this on a schedule; it closes any
 * suggestion/availability windows whose time has passed. Idempotent — safe to
 * run as often as the cron fires. Protected by CRON_SECRET (Vercel sends it as
 * a Bearer token on cron invocations).
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: if no secret is configured, never run — otherwise anyone could
  // POST here and advance/stall every formation.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  // Engine steps. A failure here must NOT skip the re-arm below — with the
  // frequent cron gone, a dropped arm would idle the engine until the daily
  // backstop — but must still surface as a 5xx so Cloud Tasks / the scheduler
  // retry this invocation.
  let engineErr: unknown = null;
  try {
    await tick(txnDb as unknown as EngineDb, now);
    // Drive the weekly poll cycle for established games: open polls, tally,
    // decide scheduled/skipped, notify, mark played.
    await runOccurrences(txnDb as unknown as EngineDb, now);
    // Snapshot recently-passed occurrences into the attendance record (regulars
    // who relied on their site default never wrote an RSVP row themselves).
    await freezeOccurrences(txnDb as unknown as EngineDb, now);
  } catch (e) {
    engineErr = e;
    console.error("[cron] engine step failed", e);
  }
  // Send the backlog of claimed-but-unsent email notifications via Brevo. Isolated
  // from the engine result: a Brevo hiccup must not 500 a successful tick (which
  // would trigger noisy retries / duplicate engine work).
  let email: unknown;
  try {
    email = await flushNotificationEmails(now);
  } catch (e) {
    console.error("[cron] email flush failed", e);
    email = { error: true };
  }
  // Re-arm: enqueue a one-shot wake for the engine's next time boundary. This is
  // what makes the tick self-sustaining without a frequent cron; the remaining
  // daily cron is only the dead-man backstop. Never throws (see scheduleTick).
  const nextTickAt = await scheduleNextTick(txnDb as unknown as EngineDb);
  if (engineErr) {
    return NextResponse.json({ error: "engine step failed", nextTickAt }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ranAt: now.toISOString(), email, nextTickAt });
}

export const GET = handle;
export const POST = handle;
