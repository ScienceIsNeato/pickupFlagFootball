import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  await tick(db as unknown as EngineDb, new Date());
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
