import { NextResponse } from "next/server";
import { txnDb } from "@/lib/db/pool";
import { tick } from "@/lib/mime/engine";
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
  await tick(txnDb as unknown as EngineDb, new Date());
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
