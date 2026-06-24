import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeHitDistance, CELL_HIT_RADIUS } from "@/lib/map/hit";

const GAME_BADGE = 92;     // must match MapView
const PROPOSED_BADGE = 68;

// "nearest cluster" the way MapView resolves a click: smallest non-null
// hit-distance wins.
function pick(
  click: { x: number; y: number },
  clusters: Array<{ base: { x: number; y: number }; size: number | null; id: string }>,
): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const c of clusters) {
    const d = badgeHitDistance(c.base, click, c.size);
    if (d != null && d < bestD) { bestD = d; best = c.id; }
  }
  return best;
}

test("click inside the badge square hits it; outside misses", () => {
  const base = { x: 200, y: 300 };               // badge rect: x[154,246] y[208,300]
  assert.notEqual(badgeHitDistance(base, { x: 200, y: 220 }, GAME_BADGE), null); // top-ish, inside
  assert.notEqual(badgeHitDistance(base, { x: 200, y: 299 }, GAME_BADGE), null); // just above base
  assert.equal(badgeHitDistance(base, { x: 200, y: 320 }, GAME_BADGE), null);    // below base — miss
  assert.equal(badgeHitDistance(base, { x: 260, y: 250 }, GAME_BADGE), null);    // right of square — miss
});

test("the reported bug: clicking a game badge must not select a neighboring proposed site", () => {
  // Geometry from the report — badges that do NOT visually overlap, but the
  // proposed site's BASE sits near where you click on the tall game badge.
  const game = { base: { x: 200, y: 300 }, size: GAME_BADGE, id: "game" };
  const proposed = { base: { x: 210, y: 215 }, size: PROPOSED_BADGE, id: "proposed" };
  const clickOnGameLogo = { x: 200, y: 220 };

  // Click is inside the game square, NOT inside the proposed square.
  assert.notEqual(badgeHitDistance(game.base, clickOnGameLogo, game.size), null);
  assert.equal(badgeHitDistance(proposed.base, clickOnGameLogo, proposed.size), null);
  assert.equal(pick(clickOnGameLogo, [game, proposed]), "game");

  // The OLD disc-around-base logic would have picked "proposed": its base is
  // only ~11px from the click vs ~80px for the game's base. Prove that gap so a
  // regression back to radius-on-base is caught.
  const dGameBase = Math.hypot(200 - 200, 300 - 220);       // 80
  const dPropBase = Math.hypot(210 - 200, 215 - 220);       // ~11.2
  assert.ok(dPropBase < dGameBase, "neighbor base was closer — the trap the old code fell into");
});

test("plain (badge-less) cells use the circular radius", () => {
  const base = { x: 100, y: 100 };
  assert.notEqual(badgeHitDistance(base, { x: 100 + CELL_HIT_RADIUS - 1, y: 100 }, null), null);
  assert.equal(badgeHitDistance(base, { x: 100 + CELL_HIT_RADIUS + 1, y: 100 }, null), null);
});
