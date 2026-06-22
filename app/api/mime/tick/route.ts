import { NextResponse } from "next/server";
import { txnDb } from "@/lib/db/pool";
import { tick } from "@/lib/mime/engine";
import { runOccurrences } from "@/lib/mime/occurrences";
import { freezeOccurrences } from "@/lib/mime/freeze";
import { flushNotificationEmails } from "@/lib/email/flush";
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
  await tick(txnDb as unknown as EngineDb, now);
  // Drive the weekly poll cycle for established games: open polls, tally, decide
  // scheduled/skipped, notify, mark played.
  await runOccurrences(txnDb as unknown as EngineDb, now);
  // Snapshot recently-passed occurrences into the attendance record (regulars who
  // relied on their site default never wrote an RSVP row themselves).
  await freezeOccurrences(txnDb as unknown as EngineDb, now);
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
  return NextResponse.json({ ok: true, ranAt: now.toISOString(), email });
}

export const GET = handle;
export const POST = handle;
