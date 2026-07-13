import { NextResponse } from "next/server";
import { cellToLatLng } from "h3-js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  interestSignals, areas, games, gameRoster, formationAttempts,
} from "@/lib/db/schema";
import { bigIntToH3, cellToParentSafe } from "@/lib/geo/h3";
import { gameColor } from "@/lib/brand";

export const dynamic = "force-dynamic";

type Claim = { lat: number; lng: number; color: string; count: number };

/**
 * Zillow-style cluster feed. Aggregates active interest into H3 cells at the
 * requested resolution (3–7). A player on an established game's roster is
 * "claimed" by that game — wherever they live — split from the free pool, tinted
 * the game's color, and (client-side) pointed at the game. Membership is the
 * roster, NOT proximity: members are spread across the eligible area, interleaved
 * with free interest (people who passed on that game). Free interest is what the
 * cursor courts.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const reqRes = Number(url.searchParams.get("res"));
  const res = Number.isFinite(reqRes) ? Math.max(3, Math.min(7, reqRes)) : 5;
  const mineOnly = url.searchParams.get("mine") === "1";
  const me = session.user.id;

  const signals = await db
    .select({ h3Base: interestSignals.h3Base, userId: interestSignals.userId })
    .from(interestSignals)
    .where(eq(interestSignals.active, true));

  // Established games: location (place coords, else area center) + color +
  // (denormalised here) areaId so we can decide "is this one of mine?".
  const gameRows = await db
    .select({
      id: games.id, areaId: games.areaId, color: games.color, status: games.status,
      placeLat: games.placeLat, placeLng: games.placeLng,
      h3Cell: areas.h3Cell, centerLat: areas.centerLat, centerLng: areas.centerLng,
    })
    .from(games).innerJoin(areas, eq(games.areaId, areas.id))
    // Retired series stay on the map (greyed badge → RETIRED view + history); the
    // engine ignores them and (below) they don't claim interest flags.
    .where(inArray(games.status, ["active", "paused", "retired"]));

  // "mine" mode: a game is mine if I'm on its roster OR I have active interest in
  // its area. Filter the cluster feed down to those games' badges + their claims;
  // free interest, other games, and forming sites are all suppressed.
  let mineGameIds: Set<string> | null = null;
  if (mineOnly) {
    const [myRoster, myInterest] = await Promise.all([
      db.select({ gameId: gameRoster.gameId }).from(gameRoster).where(eq(gameRoster.userId, me)),
      db.select({ areaId: interestSignals.areaId })
        .from(interestSignals)
        .where(and(eq(interestSignals.userId, me), eq(interestSignals.active, true))),
    ]);
    const myAreaIds = new Set(myInterest.map((r) => r.areaId));
    mineGameIds = new Set<string>(myRoster.map((r) => r.gameId));
    for (const g of gameRows) if (myAreaIds.has(g.areaId)) mineGameIds.add(g.id);
  }

  const gameInfo = new Map<string, { lat: number; lng: number; color: string }>();
  const gameCellColor = new Map<string, string>();   // display cell → game color (the ring)
  const gameAtCell = new Map<string, string>();       // display cell → gameId (for the member badge)
  const retiredIds = new Set<string>();               // games the engine no longer runs
  for (const g of gameRows) {
    if (mineGameIds && !mineGameIds.has(g.id)) continue;
    // Prefer the stored color; fall back to the deterministic hash for any
    // legacy row inserted before the color column was added.
    const color = g.color ?? gameColor(g.id);
    gameInfo.set(g.id, { lat: g.placeLat ?? g.centerLat, lng: g.placeLng ?? g.centerLng, color });
    if (g.status === "retired") retiredIds.add(g.id);
    const parent = cellToParentSafe(bigIntToH3(g.h3Cell), res);
    if (!parent) continue;
    const prev = gameAtCell.get(parent);
    // One badge per display cell. First placed wins, EXCEPT a live game displaces
    // a retired one — so when areas collapse to a single cell at low zoom an
    // active game is never hidden or greyed behind a retired neighbor. The cell's
    // `retired` flag (below) is read off whichever game wins here, so the badge
    // style, click target, and member tally always describe the same game.
    if (prev === undefined || (retiredIds.has(prev) && g.status !== "retired")) {
      gameCellColor.set(parent, color);
      gameAtCell.set(parent, g.id);
    }
  }

  // Roster → which game(s) claim each user, and each game's member tally.
  // A user can be on multiple rosters (multi-area locals); each membership
  // produces its own claim, so the map shows that user as one flag per game.
  const claimsByUser = new Map<string, string[]>();
  const memberCount = new Map<string, number>();
  if (gameInfo.size) {
    const roster = await db
      .select({ gameId: gameRoster.gameId, userId: gameRoster.userId })
      .from(gameRoster).where(inArray(gameRoster.gameId, [...gameInfo.keys()]));
    for (const r of roster) {
      // A dead game shouldn't pull interest. Retire releases the roster (see
      // captain-actions), so there's normally nothing retired to skip here — the
      // guard also covers any game retired before that change, whose rows linger.
      if (!gameInfo.has(r.gameId) || retiredIds.has(r.gameId)) continue;
      const list = claimsByUser.get(r.userId) ?? claimsByUser.set(r.userId, []).get(r.userId)!;
      if (!list.includes(r.gameId)) {
        list.push(r.gameId);
        memberCount.set(r.gameId, (memberCount.get(r.gameId) ?? 0) + 1);
      }
    }
  }

  // Live proposals (OPEN attempts) — each is an independent proposed game site,
  // not yet scheduled. Suppressed in "mine" mode (that view is established games).
  // The badge sits at the proposed venue, not the cell centroid; one forming
  // badge per display cell (last proposal in a cell wins the point).
  const formingCells = new Set<string>();
  const formingPoint = new Map<string, { lat: number; lng: number }>();
  if (!mineOnly) {
    const openAttempts = await db.select({
      lat: formationAttempts.placeLat, lng: formationAttempts.placeLng,
      areaLat: areas.centerLat, areaLng: areas.centerLng, h3Cell: areas.h3Cell,
    }).from(formationAttempts)
      .innerJoin(areas, eq(areas.id, formationAttempts.areaId))
      .where(eq(formationAttempts.status, "OPEN"))
      // Oldest→newest so "last proposal in a cell wins the point" is deterministic
      // (the newest overwrites), not query-plan dependent.
      .orderBy(asc(formationAttempts.createdAt));
    for (const a of openAttempts) {
      const parent = cellToParentSafe(bigIntToH3(a.h3Cell), res);
      if (!parent) continue;
      formingCells.add(parent);
      // Fall back to the area centroid when the proposal has no exact venue coords:
      // /api/proposed matches at placeLat/Lng ?? area.centerLat/Lng, so the badge has
      // to sit there too or clicking it can't find the proposal.
      const pLat = a.lat ?? a.areaLat, pLng = a.lng ?? a.areaLng;
      if (pLat != null && pLng != null) formingPoint.set(parent, { lat: pLat, lng: pLng });
    }
  }

  const free = new Map<string, Set<string>>();
  const claims = new Map<string, Map<string, Set<string>>>(); // cell → gameId → users
  for (const s of signals) {
    const parent = cellToParentSafe(bigIntToH3(s.h3Base), res);
    if (!parent) continue;
    // A user rostered on multiple games gets one claim per game (rendered as one
    // colored flag per game). gameInfo is already mine-filtered above.
    const gids = (claimsByUser.get(s.userId) ?? []).filter((g) => gameInfo.has(g));
    if (gids.length > 0) {
      const cellClaims = claims.get(parent) ?? claims.set(parent, new Map()).get(parent)!;
      for (const gid of gids) {
        (cellClaims.get(gid) ?? cellClaims.set(gid, new Set()).get(gid)!).add(s.userId);
      }
    } else if (!mineOnly) {
      (free.get(parent) ?? free.set(parent, new Set()).get(parent)!).add(s.userId);
    }
  }

  const allCells = new Set<string>([
    ...free.keys(), ...claims.keys(), ...gameCellColor.keys(), ...formingCells,
  ]);
  const cells = [...allCells].map((h3) => {
    const hasGame = gameCellColor.has(h3);
    const forming = !hasGame && formingCells.has(h3);
    // Badge sits on the game's actual venue (place lat/lng for games; first
    // suggestion's lat/lng for forming sites) when known, so a click on the
    // badge sends those exact coords to /api/game or /api/proposed. Falls back
    // to the H3 cell centroid when no venue is on file (e.g. seeded games).
    const venue = hasGame ? gameInfo.get(gameAtCell.get(h3)!) : forming ? formingPoint.get(h3) : undefined;
    const [lat, lng] = venue ? [venue.lat, venue.lng] : cellToLatLng(h3);
    const cellClaims = claims.get(h3);
    const claimsOut: Claim[] = cellClaims
      ? [...cellClaims.entries()].map(([gid, users]) => {
          const g = gameInfo.get(gid)!;
          return { lat: g.lat, lng: g.lng, color: g.color, count: users.size };
        })
      : [];
    // Read retired off the game that actually won this cell — so the greyed
    // badge, click target, ring, and tally never describe different games.
    const retired = hasGame ? retiredIds.has(gameAtCell.get(h3)!) : false;
    return {
      h3, lat, lng,
      count: free.get(h3)?.size ?? 0,           // FREE interest only
      hasGame,
      forming,
      retired,
      // Retired badges render greyed with no ring/count — drop the color + tally.
      gameColor: hasGame && !retired ? gameCellColor.get(h3) : undefined,
      gameMembers: hasGame && !retired ? memberCount.get(gameAtCell.get(h3)!) ?? 0 : undefined,
      claims: claimsOut,
    };
  });

  return NextResponse.json({ res, cells });
}
