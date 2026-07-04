import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveViewerAreaScenario } from "@/lib/mime/areaScenario";
import { skin } from "@/lib/skin";
import type { EngineDb } from "@/lib/mime/engine";

export const dynamic = "force-dynamic";

/**
 * The map HUD's live data source — polled client-side so the scenario (game
 * counts, interest tallies, proposal status) stays correct after a propose,
 * join, or interest change instead of freezing at whatever the page's initial
 * server render happened to show. `scenario: null` means the viewer has no
 * area yet (same "don't guess, render nothing" rule as the page's own initial
 * render) — the client should leave whatever it's already showing alone.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const resolved = await resolveViewerAreaScenario(db as unknown as EngineDb, skin.slug, session.user.id);
  return NextResponse.json(resolved ?? { scenario: null, place: null });
}
