import { NextResponse } from "next/server";
import { cellToParent, cellToLatLng } from "h3-js";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { interestSignals, areas } from "@/lib/db/schema";
import { bigIntToH3 } from "@/lib/geo/h3";

export const dynamic = "force-dynamic";

/**
 * Zillow-style cluster feed. Aggregates active interest into H3 cells at the
 * requested resolution (3–7); the client picks the resolution from the map
 * zoom, so cells merge as you zoom out and split as you zoom in. Counts are
 * distinct users per cell. has_game accents cells with a scheduled game.
 */
export async function GET(req: Request) {
  // The map (and this aggregate interest feed behind it) is sign-in-gated like
  // the find-a-game page it lives on — don't let it be scraped anonymously.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const reqRes = Number(url.searchParams.get("res"));
  const res = Number.isFinite(reqRes) ? Math.max(3, Math.min(7, reqRes)) : 5;

  const signals = await db
    .select({ h3Base: interestSignals.h3Base, userId: interestSignals.userId })
    .from(interestSignals)
    .where(eq(interestSignals.active, true));

  // distinct users per parent cell at the requested resolution
  const byCell = new Map<string, Set<string>>();
  for (const s of signals) {
    const parent = cellToParent(bigIntToH3(s.h3Base), res);
    (byCell.get(parent) ?? byCell.set(parent, new Set()).get(parent)!).add(s.userId);
  }

  // cells with a scheduled game vs. a live formation (a proposed game site)
  const marked = await db
    .select({ h3Cell: areas.h3Cell, status: areas.status })
    .from(areas)
    .where(inArray(areas.status, ["SCHEDULED", "IN_FORMATION"]));
  const gameCells = new Set<string>();
  const formingCells = new Set<string>();
  for (const a of marked) {
    const parent = cellToParent(bigIntToH3(a.h3Cell), res);
    (a.status === "SCHEDULED" ? gameCells : formingCells).add(parent);
  }

  // Emit every cell that has interest OR a game/forming site. A freshly proposed
  // site often lands in a cell with no interest of its own, so it must be added
  // here or its badge would never appear.
  const allCells = new Set<string>([...byCell.keys(), ...gameCells, ...formingCells]);
  const cells = [...allCells].map((h3) => {
    const [lat, lng] = cellToLatLng(h3);
    const hasGame = gameCells.has(h3);
    // a scheduled game wins over a forming one if both roll up into the same cell
    return { h3, lat, lng, count: byCell.get(h3)?.size ?? 0, hasGame, forming: !hasGame && formingCells.has(h3) };
  });

  return NextResponse.json({ res, cells });
}
