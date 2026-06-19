// Brand palette. Flags represent two teams — yellow vs red — bright and opaque
// so they stand out against the green field.
export const TEAM_YELLOW = "#f4c430";
export const TEAM_RED = "#e23b2e";
export const TEAM_COLORS = [TEAM_YELLOW, TEAM_RED] as const;

// Per-game colors. Each established game gets one (ring + its claimed flags).
// Deterministic from the game id so it's stable across renders, and distinct
// from the yellow/red team flags so claimed ≠ free at a glance.
export const GAME_COLORS = [
  "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#f59e0b",
  "#8b5cf6", "#06b6d4", "#f43f5e", "#84cc16", "#0ea5e9",
] as const;

export function gameColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GAME_COLORS[h % GAME_COLORS.length];
}

// "grass fields" palette — light → dark. Mirrored in CSS custom properties for
// UI accents; available here for the canvas (map tint accents, count labels).
export const GRASS = {
  l1: "#5b9452",
  l2: "#468944",
  l3: "#3f7a39",
  l4: "#376f32",
  l5: "#30632a",
} as const;
