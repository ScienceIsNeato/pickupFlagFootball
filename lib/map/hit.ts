// Screen-space hit-testing for map markers.
//
// Badges are drawn anchored at their BASE point (the cluster's projected
// lng/lat) and extend UPWARD: a square of side `badgeSize`, centered on base.x,
// with its bottom edge at base.y (see MapView's drawImage(img, x-sz/2, y-sz,
// sz, sz)). The earlier click handler hit-tested a *circular* disc of radius
// ~badgeSize around the base, which (a) doesn't match the drawn square and
// (b) reaches well below/around the base — so a click on a tall game badge
// could land closer to a *neighboring* marker's base and select the wrong one,
// even when the badges don't visually overlap. Test the actual drawn rectangle
// instead (this is exactly what the hover test already does).

export const CELL_HIT_RADIUS = 60; // plain (badge-less) cell: circular pick radius

/**
 * Returns a tie-break distance if `click` hits the marker at projected `base`,
 * or null if it misses.
 *
 * @param badgeSize px side of the badge square, or null for a plain cell (no
 *   badge — e.g. an empty r7 cell you can click to propose a game).
 *
 * For a badge: hit iff the click is inside the drawn square
 *   x ∈ [base.x - s/2, base.x + s/2], y ∈ [base.y - s, base.y]
 * and the tie-break distance is to the badge's visual center (base.y - s/2),
 * so when two badges genuinely overlap the nearer-centered one wins.
 *
 * For a plain cell: hit iff within CELL_HIT_RADIUS of the base.
 */
export function badgeHitDistance(
  base: { x: number; y: number },
  click: { x: number; y: number },
  badgeSize: number | null,
): number | null {
  if (badgeSize != null) {
    const half = badgeSize / 2;
    const inside =
      click.x >= base.x - half &&
      click.x <= base.x + half &&
      click.y >= base.y - badgeSize &&
      click.y <= base.y;
    if (!inside) return null;
    return Math.hypot(base.x - click.x, base.y - half - click.y);
  }
  const d = Math.hypot(base.x - click.x, base.y - click.y);
  return d < CELL_HIT_RADIUS ? d : null;
}
